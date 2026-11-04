// Google Gemini generateContent, plain fetch (no SDK). Shapes from the Gemini API docs
// (ai.google.dev), read 04/11/26:
//   POST /v1beta/models/<model>:generateContent; header x-goog-api-key.
//   { systemInstruction: { parts: [{ text }] }, contents, tools: [{ functionDeclarations }] };
//   a declaration's `parameters` is a subset of the OpenAPI schema, so the shared JSON
//   Schema is narrowed to the fields that subset has (types in upper case, as the docs
//   write them). The reply's candidates[0].content.parts hold text and functionCall
//   ({ name, args, id }) parts; the model's content goes back unchanged (it carries the
//   thought signatures the API requires back), and each result is a functionResponse
//   ({ name, id, response, parts: [{ inlineData: { mimeType, data } }] } for an image).
import { GEMINI_BASE } from './hosts';
import { postJson, ProviderError, type Adapter, type ToolSpec, type Turn } from './types';

export { GEMINI_DEFAULT_MODEL } from '../../catalog';

type Part = Record<string, unknown>;

const KEEP = ['description', 'enum', 'required', 'minimum', 'maximum', 'minLength', 'maxLength'];
const SAFE_INT = Number.MAX_SAFE_INTEGER;

/** JSON Schema to the OpenAPI subset of a Gemini function declaration */
export function geminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof schema.type === 'string') out.type = schema.type.toUpperCase();
  for (const k of KEEP) {
    const v = schema[k];
    if (v === undefined) continue;
    // Zod writes the safe-integer range on every int; it says nothing a model needs
    if ((k === 'minimum' || k === 'maximum') && Math.abs(Number(v)) >= SAFE_INT) continue;
    out[k] = v;
  }
  if (schema.properties && typeof schema.properties === 'object') {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([k, v]) => [k, geminiSchema(v)]),
    );
  }
  if (schema.items && typeof schema.items === 'object') out.items = geminiSchema(schema.items as Record<string, unknown>);
  return out;
}

export function geminiDeclaration(t: ToolSpec): Record<string, unknown> {
  const props = t.parameters.properties as Record<string, unknown> | undefined;
  const hasArgs = !!props && Object.keys(props).length > 0;
  return { name: t.name, description: t.description, ...(hasArgs ? { parameters: geminiSchema(t.parameters) } : {}) };
}

function contents(turns: Turn[]) {
  return turns.map((t) => {
    if (t.role === 'user') return { role: 'user', parts: [{ text: t.text }] };
    if (t.role === 'assistant') return t.raw as Record<string, unknown>;
    return {
      role: 'user',
      parts: t.results.map((r) => ({
        functionResponse: {
          name: r.name,
          ...(r.id.startsWith('gemini-') ? {} : { id: r.id }),
          response: r.isError ? { error: r.text } : { result: r.text },
          ...(r.image ? { parts: [{ inlineData: { mimeType: r.image.mediaType, data: r.image.base64 } }] } : {}),
        },
      })),
    };
  });
}

export const geminiAdapter: Adapter = async (req) => {
  const data = await postJson(
    `${GEMINI_BASE}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
    { 'x-goog-api-key': req.key },
    {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: contents(req.turns),
      tools: [{ functionDeclarations: req.tools.map(geminiDeclaration) }],
    },
    req.signal,
    'Google Gemini',
  );
  const blocked = (data.promptFeedback as { blockReason?: string } | undefined)?.blockReason;
  if (blocked) throw new ProviderError(`Gemini declined this request (${blocked}).`);
  const cand = (Array.isArray(data.candidates) ? data.candidates[0] : undefined) as
    | { content?: { role?: string; parts?: Part[] }; finishReason?: string }
    | undefined;
  if (!cand?.content) throw new ProviderError(`Gemini sent no answer${cand?.finishReason ? ` (${cand.finishReason})` : ''}.`);
  const parts = cand.content.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => String(p.text))
    .join('\n')
    .trim();
  let n = 0;
  const calls = parts
    .filter((p) => p.functionCall)
    .map((p) => {
      const fc = p.functionCall as { name?: string; args?: Record<string, unknown>; id?: string };
      return { id: fc.id ? String(fc.id) : `gemini-${++n}`, name: String(fc.name), args: fc.args ?? {} };
    });
  return { text, calls, raw: { role: 'model', parts } };
};
