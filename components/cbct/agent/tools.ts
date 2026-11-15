// The in-page agent's tools: the fifteen verbs of the MCP server, from the one shared module
// (lib/shared/verbs.mjs), executed in the viewer's page through the page transport into
// useAgentBridge, the same hook the loopback bridge drives. The agent frame asks for each call
// by message (agentFrame.ts); it never runs a verb itself. No wider surface: an unknown name is
// refused, and the arguments are checked against the verb's own Zod schema before anything
// moves. Stop aborts a call in flight; a call that outlasts the bus timeout fails.
import { describe, inputJsonSchema, verb as verbOf, VERBS } from '@/lib/shared/verbs.mjs';
import type { PageTransport } from '../agentTransport';
import { source } from '../source';
import type { ToolOutcome } from './frame/protocol';
import type { ToolImage, ToolSpec } from './frame/providers/types';

/** the tool list every provider receives: name, description, JSON Schema of the input */
export const PAGE_TOOLS: ToolSpec[] = VERBS.map((v) => ({
  name: v.name,
  description: v.description,
  parameters: inputJsonSchema(v.name),
}));

export type { ToolOutcome };

/** the longer side of a snapshot sent to a model, in pixels (the providers' image limits) */
export const SNAPSHOT_MAX_SIDE = 2000;

const json = (v: unknown) => JSON.stringify(v, null, 2);

const NO_OPEN =
  'In the browser and the desktop app the agent cannot open a scan: ask the clinician to open it with the open menu (or by dropping it on the viewer), then call list_volumes.';

/** scale a PNG down so its longer side is at most SNAPSHOT_MAX_SIDE; smaller ones pass unchanged */
async function fitSnapshot(base64: string): Promise<ToolImage> {
  const png: ToolImage = { mediaType: 'image/png', base64 };
  if (typeof document === 'undefined' || typeof Image === 'undefined') return png;
  const img = new Image();
  img.src = `data:image/png;base64,${base64}`;
  try {
    await img.decode();
  } catch {
    return png;
  }
  const side = Math.max(img.naturalWidth, img.naturalHeight);
  if (side <= SNAPSHOT_MAX_SIDE) return png;
  const k = SNAPSHOT_MAX_SIDE / side;
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  const ctx = c.getContext('2d');
  if (!ctx) return png;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { mediaType: 'image/png', base64: c.toDataURL('image/png').slice('data:image/png;base64,'.length) };
}

/** Run one tool call from the model. Never throws: a failure is an error result for the model. */
export async function executeTool(
  transport: PageTransport,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ToolOutcome> {
  let v;
  try {
    v = verbOf(name);
  } catch {
    return { text: `unknown tool: ${name}. The tools are the fifteen CBCTScope verbs only.`, isError: true };
  }
  const parsed = v.inputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    return { text: `invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`, isError: true };
  }
  const a = parsed.data as Record<string, unknown>;
  const route = v.route;
  try {
    if (route.kind === 'open') return { text: NO_OPEN, isError: true };
    if (route.kind === 'catalog') return { text: json(await source.list()), isError: false };
    const bridgeArgs = name === 'reset_view' ? { full: a.full === true } : { ...a, ...(route.args ?? {}) };
    const out = await transport.dispatch(route.verb, bridgeArgs, { signal });
    if (!out.ok) return { text: out.error ?? `${name} failed`, isError: true };
    const result = (out.result ?? {}) as Record<string, unknown>;
    if (name === 'list_views') return { text: json(result.views ?? []), isError: false };
    if (name === 'snapshot') {
      const state = result.state ?? null;
      return { text: describe(state), image: await fitSnapshot(String(result.pngBase64 ?? '')), isError: false };
    }
    return { text: `${describe(result)}\n${json(result)}`, isError: false };
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), isError: true };
  }
}
