// The in-page agent's loop, run inside the sandboxed agent frame (docs/web-build.md section 2;
// manual section 9.6). One clinician request is one turn: the model gets the fence as its
// system prompt and the fifteen verbs as its tools (both sent by the page); each tool call goes
// to the page through `exec` (the page runs it through pageTransport) and its result goes back
// to the model (a snapshot as an image), until the model answers in text. A runaway guard stops
// a turn after MAX_TOOL_CALLS calls; Stop aborts the request in flight. A call whose arguments
// are not valid JSON is answered with an argument error and runs nothing.
import { MAX_TOOL_CALLS, type AgentEvent, type ToolOutcome } from './protocol';
import type { Adapter, ToolResult, ToolSpec, Turn } from './providers/types';

export { MAX_TOOL_CALLS };
export type { AgentEvent };

export interface TurnOptions {
  adapter: Adapter;
  /** run one verb in the page; never throws (a failure is an error outcome) */
  exec: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolOutcome>;
  system: string;
  tools: ToolSpec[];
  model: string;
  key: string;
  endpoint: string;
  /** the conversation so far; the turn appends to it in place */
  turns: Turn[];
  request: string;
  signal: AbortSignal;
  onEvent: (e: AgentEvent) => void;
}

export class RunawayError extends Error {}

const aborted = () => new DOMException('stopped', 'AbortError');

/** Run one turn. Resolves with the model's closing text; rejects on abort, error or runaway. */
export async function runTurn(o: TurnOptions): Promise<string> {
  o.turns.push({ role: 'user', text: o.request });
  let used = 0;
  for (;;) {
    if (o.signal.aborted) throw aborted();
    const reply = await o.adapter({
      system: o.system,
      tools: o.tools,
      turns: o.turns,
      model: o.model,
      key: o.key,
      endpoint: o.endpoint,
      signal: o.signal,
    });
    o.turns.push({ role: 'assistant', text: reply.text, calls: reply.calls, raw: reply.raw });
    if (reply.text) o.onEvent({ kind: 'text', text: reply.text });
    if (!reply.calls.length) return reply.text;
    if (used + reply.calls.length > MAX_TOOL_CALLS) {
      // answer the pending calls so the conversation stays well formed for the next turn
      o.turns.push({
        role: 'tool',
        results: reply.calls.map((c) => ({ id: c.id, name: c.name, text: 'stopped: tool-call limit for this request reached', isError: true })),
      });
      throw new RunawayError(
        `Stopped after ${used} tool calls: one request may use at most ${MAX_TOOL_CALLS}. Ask again in smaller steps.`,
      );
    }
    const results: ToolResult[] = [];
    for (const c of reply.calls) {
      if (o.signal.aborted) throw aborted();
      used++;
      o.onEvent({ kind: 'call', name: c.name, args: c.args });
      const r: ToolOutcome = c.argsError
        ? { text: `invalid arguments for ${c.name}: ${c.argsError}`, isError: true }
        : await o.exec(c.name, c.args, o.signal);
      if (o.signal.aborted) throw aborted();
      o.onEvent({ kind: 'result', name: c.name, text: r.text, isError: r.isError, image: !!r.image });
      results.push({ id: c.id, name: c.name, text: r.text, image: r.image, isError: r.isError });
    }
    o.turns.push({ role: 'tool', results });
  }
}
