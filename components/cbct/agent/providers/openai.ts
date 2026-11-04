// OpenAI Responses API, plain fetch (no SDK). Shapes from the OpenAI API reference, read
// 04/11/26: the current models (gpt-6-astra) support Chat Completions but "tool calling
// requires Responses", so the cloud adapter speaks Responses.
//   POST /v1/responses; Authorization: Bearer <key>; { model, instructions, input, tools,
//   store: false }. tools: [{ type: 'function', name, description, parameters }].
//   The reply's output holds function_call items ({ call_id, name, arguments: JSON string })
//   and message items (output_text, refusal). With store: false every output item is sent
//   back in the next input (reasoning items carry their encrypted content), followed by one
//   function_call_output per call, whose output may be a list of input_text and input_image
//   (a data URL) parts.
import { OPENAI_BASE } from './hosts';
import { parseArgs, postJson, ProviderError, type Adapter, type Turn } from './types';

export const OPENAI_DEFAULT_MODEL = 'gpt-6-astra';

type Item = Record<string, unknown>;

function input(turns: Turn[]): Item[] {
  const out: Item[] = [];
  for (const t of turns) {
    if (t.role === 'user') out.push({ role: 'user', content: t.text });
    else if (t.role === 'assistant') out.push(...(t.raw as Item[]));
    else {
      for (const r of t.results) {
        out.push({
          type: 'function_call_output',
          call_id: r.id,
          output: [
            { type: 'input_text', text: r.isError ? `error: ${r.text}` : r.text },
            ...(r.image ? [{ type: 'input_image', image_url: `data:${r.image.mediaType};base64,${r.image.base64}` }] : []),
          ],
        });
      }
    }
  }
  return out;
}

export const openaiAdapter: Adapter = async (req) => {
  const data = await postJson(
    `${OPENAI_BASE}/v1/responses`,
    { authorization: `Bearer ${req.key}` },
    {
      model: req.model,
      instructions: req.system,
      input: input(req.turns),
      tools: req.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })),
      store: false,
    },
    req.signal,
    'OpenAI',
  );
  if (data.status && data.status !== 'completed') {
    throw new ProviderError(`OpenAI ended the reply early (${String(data.status)}).`);
  }
  const output = (Array.isArray(data.output) ? data.output : []) as Item[];
  const texts: string[] = [];
  for (const item of output) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content as Item[]) {
      if (part.type === 'output_text') texts.push(String(part.text ?? ''));
      else if (part.type === 'refusal') texts.push(String(part.refusal ?? 'The model declined this request.'));
    }
  }
  const calls = output
    .filter((i) => i.type === 'function_call')
    .map((i) => ({ id: String(i.call_id), name: String(i.name), args: parseArgs(i.arguments) }));
  return { text: texts.join('\n').trim(), calls, raw: output };
};
