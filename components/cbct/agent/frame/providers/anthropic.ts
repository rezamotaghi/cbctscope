// Anthropic Messages API, plain fetch (no SDK). Shapes from the claude-api reference and
// platform.claude.com, read 04/11/26:
//   POST /v1/messages; headers x-api-key, anthropic-version 2026-10-21, and
//   anthropic-dangerous-direct-browser-access: true (the header the official TypeScript SDK
//   sends when a browser calls the API directly; without it the API refuses CORS requests).
//   tools: [{ name, description, input_schema }]; the reply's content holds text and
//   tool_use blocks ({ id, name, input }); results go back as tool_result blocks in one user
//   message, an image as { type: 'image', source: { type: 'base64', media_type, data } }.
//   The assistant's content is sent back unchanged (thinking blocks included).
import { ANTHROPIC_BASE } from './hosts';
import { postJson, ProviderError, type Adapter, type Turn } from './types';

export { ANTHROPIC_DEFAULT_MODEL } from '../../catalog';
const API_VERSION = '2026-10-21';

type Block = Record<string, unknown>;

function messages(turns: Turn[]) {
  return turns.map((t) => {
    if (t.role === 'user') return { role: 'user', content: t.text };
    if (t.role === 'assistant') return { role: 'assistant', content: t.raw as Block[] };
    return {
      role: 'user',
      content: t.results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        is_error: r.isError,
        content: [
          { type: 'text', text: r.text },
          ...(r.image
            ? [{ type: 'image', source: { type: 'base64', media_type: r.image.mediaType, data: r.image.base64 } }]
            : []),
        ],
      })),
    };
  });
}

export const anthropicAdapter: Adapter = async (req) => {
  const data = await postJson(
    `${ANTHROPIC_BASE}/v1/messages`,
    {
      'x-api-key': req.key,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    {
      model: req.model,
      max_tokens: 16000,
      system: req.system,
      tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      messages: messages(req.turns),
    },
    req.signal,
    'Anthropic',
  );
  if (data.stop_reason === 'refusal') throw new ProviderError('The model declined this request.');
  const content = (Array.isArray(data.content) ? data.content : []) as Block[];
  const text = content
    .filter((b) => b.type === 'text')
    .map((b) => String(b.text ?? ''))
    .join('\n')
    .trim();
  const calls = content
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: String(b.id), name: String(b.name), args: (b.input ?? {}) as Record<string, unknown> }));
  return { text, calls, raw: content };
};
