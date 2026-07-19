// SERVER-ONLY. The agent bridge bus: MCP (or any local automation) drives the viewer UI.
//
// Flow: POST /api/agent/command enqueues a command and awaits its result; the browser holds
// an SSE connection to /api/agent/events, executes each command against the live viewer
// state, and POSTs the outcome to /api/agent/result, which resolves the awaiting promise.
//
// MDR fence (by construction, not just policy): every command is navigation or visualization
// (open, select, window, view mode, slice, snapshot). Nothing here computes, stores, or
// returns findings or diagnoses, and nothing executes agent-supplied code.
import crypto from 'node:crypto';

export interface AgentCommand {
  id: string;
  verb: string;
  args: Record<string, unknown>;
}

interface Pending {
  resolve: (v: { ok: boolean; result?: unknown; error?: string }) => void;
  timer: NodeJS.Timeout;
}

type Subscriber = (cmd: AgentCommand) => void;

// Anchored on globalThis: Next.js may bundle each route with its own module instance, and
// the SSE route and the command route must share one bus.
interface BusState {
  /** subscriber → its eviction hook (single-viewer contract: at most one entry) */
  subscribers: Map<Subscriber, () => void>;
  pending: Map<string, Pending>;
}
const g = globalThis as typeof globalThis & { __cbctAgentBus?: BusState };
const bus: BusState = (g.__cbctAgentBus ??= { subscribers: new Map(), pending: new Map() });
const { subscribers, pending } = bus;

/**
 * Single-viewer contract: the newest subscription IS the viewer. Subscribing evicts every
 * earlier subscriber (its onEvict runs, so the stale tab is told and its stream closed).
 * Without this, two open tabs would each execute every command and race their answers.
 */
export function subscribe(fn: Subscriber, onEvict: () => void = () => {}): () => void {
  for (const [oldFn, evict] of [...subscribers]) {
    subscribers.delete(oldFn);
    try {
      evict();
    } catch {
      /* stale stream already gone */
    }
  }
  subscribers.set(fn, onEvict);
  return () => subscribers.delete(fn);
}

export function hasViewer(): boolean {
  return subscribers.size > 0;
}

export function dispatchCommand(
  verb: string,
  args: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  if (!subscribers.size) {
    return Promise.resolve({ ok: false, error: 'no viewer connected — open the app in a browser first' });
  }
  const id = crypto.randomBytes(8).toString('hex');
  const cmd: AgentCommand = { id, verb, args };
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: `viewer did not answer within ${timeoutMs / 1000}s` });
    }, timeoutMs);
    pending.set(id, { resolve, timer });
    for (const fn of subscribers.keys()) fn(cmd);
  });
}

export function resolveCommand(id: string, ok: boolean, result?: unknown, error?: string): boolean {
  const p = pending.get(id);
  if (!p) return false;
  pending.delete(id);
  clearTimeout(p.timer);
  p.resolve({ ok, result, error });
  return true;
}
