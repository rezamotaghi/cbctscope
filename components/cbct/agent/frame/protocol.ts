// The messages between the viewer's page and the sandboxed agent frame (agent-frame.html,
// docs/web-build.md section 2). The frame holds the provider key, the adapters and the
// conversation; the page holds the verbs. Every message carries the channel name and the
// per-session nonce the page put in the frame's address; each side also checks the sender's
// window and origin (the page: the frame's window and the opaque origin "null"; the frame:
// its parent and the origin it was served from).
//
// page -> frame: configure (once, with the key), run, toolResult, stop
// frame -> page: ready, event, toolCall, done, error
import type { ToolImage, ToolSpec } from './providers/types';
import type { ProviderId } from '../catalog';

export const CHANNEL = 'cbctscope-agent-frame';

/** at most this many tool calls in one request (the runaway guard) */
export const MAX_TOOL_CALLS = 12;

/** a nonce: 32 lower-case hex characters */
export const NONCE_RE = /^[0-9a-f]{32}$/;

export interface ToolOutcome {
  text: string;
  image?: ToolImage;
  isError: boolean;
}

export type AgentEvent =
  | { kind: 'call'; name: string; args: Record<string, unknown> }
  | { kind: 'result'; name: string; text: string; isError: boolean; image: boolean }
  | { kind: 'text'; text: string };

export type ToFrame =
  | {
      type: 'configure';
      provider: ProviderId;
      model: string;
      endpoint: string;
      key: string;
      system: string;
      tools: ToolSpec[];
    }
  | { type: 'run'; id: number; text: string }
  | { type: 'toolResult'; id: number; callId: number; outcome: ToolOutcome }
  | { type: 'stop'; id: number };

export type FromFrame =
  | { type: 'ready' }
  | { type: 'event'; id: number; event: AgentEvent }
  | { type: 'toolCall'; id: number; callId: number; name: string; args: Record<string, unknown> }
  | { type: 'done'; id: number; text: string }
  | { type: 'error'; id: number; message: string; aborted: boolean };

export type Envelope<T> = T & { ch: typeof CHANNEL; n: string };

/** the message, when it is an object on this channel with this nonce; else null */
export function openEnvelope<T extends { type: string }>(data: unknown, nonce: string): T | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { ch?: unknown; n?: unknown; type?: unknown };
  if (d.ch !== CHANNEL || d.n !== nonce || typeof d.type !== 'string') return null;
  return data as T;
}
