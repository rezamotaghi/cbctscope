// A local or custom endpoint speaking OpenAI-compatible Chat Completions (llama-server,
// Ollama, LM Studio). Shapes from the OpenAI Chat Completions reference and the
// llama-server and Ollama compatibility docs, read 04/11/26:
//   POST <endpoint>/v1/chat/completions; Authorization: Bearer <key> only when one is given.
//   tools: [{ type: 'function', function: { name, description, parameters } }]; the reply's
//   choices[0].message carries content and tool_calls ({ id, function: { name, arguments } }).
//   A tool message carries text only, so a snapshot's image follows the tool messages as a
//   user message with an image_url part (a data URL), which all three servers accept.
//   tool_choice is not sent (Ollama does not support it).
import { parseArgs, postJson, ProviderError, type Adapter, type Turn } from './types';

type Msg = Record<string, unknown>;

function messages(system: string, turns: Turn[]): Msg[] {
  const out: Msg[] = [{ role: 'system', content: system }];
  for (const t of turns) {
    if (t.role === 'user') out.push({ role: 'user', content: t.text });
    else if (t.role === 'assistant') out.push(t.raw as Msg);
    else {
      for (const r of t.results) {
        out.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `error: ${r.text}` : r.text });
      }
      for (const r of t.results) {
        if (!r.image) continue;
        out.push({
          role: 'user',
          content: [
            { type: 'text', text: `The snapshot from the ${r.name} call: ${r.text}` },
            { type: 'image_url', image_url: { url: `data:${r.image.mediaType};base64,${r.image.base64}` } },
          ],
        });
      }
    }
  }
  return out;
}

export const localAdapter: Adapter = async (req) => {
  const base = req.endpoint.replace(/\/+$/, '');
  const data = await postJson(
    `${base}/v1/chat/completions`,
    req.key ? { authorization: `Bearer ${req.key}` } : {},
    {
      ...(req.model ? { model: req.model } : {}),
      messages: messages(req.system, req.turns),
      tools: req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    },
    req.signal,
    'the local endpoint',
  );
  const choice = (Array.isArray(data.choices) ? data.choices[0] : undefined) as { message?: Msg } | undefined;
  const msg = choice?.message;
  if (!msg) throw new ProviderError('the local endpoint sent no answer.');
  const toolCalls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : []) as {
    id?: string;
    function?: { name?: string; arguments?: unknown };
  }[];
  const calls = toolCalls.map((c, i) => ({
    id: c.id ? String(c.id) : `call-${i + 1}`,
    name: String(c.function?.name ?? ''),
    args: parseArgs(c.function?.arguments),
  }));
  // send back exactly what was answered, minus fields a strict server would refuse on input
  const raw: Msg = { role: 'assistant', content: msg.content ?? '' };
  if (toolCalls.length) {
    raw.tool_calls = toolCalls.map((c, i) => ({
      id: calls[i].id,
      type: 'function',
      function: { name: calls[i].name, arguments: typeof c.function?.arguments === 'string' ? c.function.arguments : JSON.stringify(calls[i].args) },
    }));
  }
  return { text: typeof msg.content === 'string' ? msg.content.trim() : '', calls, raw };
};
