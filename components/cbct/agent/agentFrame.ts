// The viewer's side of the agent frame (docs/web-build.md section 2). It creates the
// <iframe sandbox="allow-scripts"> on agent-frame.html (no allow-same-origin: the frame's
// origin is opaque, so it cannot read the viewer's storage or DOM), hands it the settings and
// the key once, and from then on carries requests in and tool calls out. Every tool call runs
// here, through executeTool and the page transport. The viewer's own page never contacts a
// provider: its connect-src stays 'self'.
//
// Checks on every message from the frame: the sender is this iframe's window, the origin is
// the opaque "null", the channel and the per-session nonce match. Messages to the frame go to
// its window only; an opaque origin cannot be named as a target, and the page's
// frame-src 'self' keeps the frame from being navigated anywhere else.
import { CHANNEL, openEnvelope, type AgentEvent, type FromFrame, type ToFrame, type ToolOutcome } from './frame/protocol';
import type { ToolSpec } from './frame/providers/types';
import type { ProviderId } from './catalog';

export interface FrameSettings {
  provider: ProviderId;
  model: string;
  endpoint: string;
  key: string;
  system: string;
  tools: ToolSpec[];
}

export interface AgentFrame {
  /** resolves when the frame has started and received the settings and key */
  ready: Promise<void>;
  /** one request: events as they come, tool calls through `exec`; resolves with the closing text */
  run(
    text: string,
    onEvent: (e: AgentEvent) => void,
    exec: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolOutcome>,
    signal: AbortSignal,
  ): Promise<string>;
  /** remove the frame: its memory, the key included, goes with it */
  destroy(): void;
}

export class FrameStopped extends Error {}

/** the frame page's address under the build's base path */
export const AGENT_FRAME_PATH = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/agent-frame.html`;

export function newNonce(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const READY_TIMEOUT_MS = 10_000;

export function createAgentFrame(settings: FrameSettings): AgentFrame {
  const nonce = newNonce();
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.setAttribute('title', 'CBCTScope agent frame');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.dataset.testid = 'agent-frame';
  iframe.style.display = 'none';
  iframe.src = `${AGENT_FRAME_PATH}#n=${nonce}`;

  let key = settings.key; // forgotten as soon as it is posted
  let nextId = 0;
  let destroyed = false;
  const runs = new Map<
    number,
    {
      onEvent: (e: AgentEvent) => void;
      exec: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<ToolOutcome>;
      signal: AbortSignal;
      resolve: (text: string) => void;
      reject: (err: Error) => void;
    }
  >();

  const post = (msg: ToFrame) => iframe.contentWindow?.postMessage({ ...msg, ch: CHANNEL, n: nonce }, '*');

  let readyResolve: () => void = () => {};
  let readyReject: (e: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const readyTimer = setTimeout(() => readyReject(new Error('the agent frame did not start')), READY_TIMEOUT_MS);
  ready.catch(() => {}); // a caller that never awaits it must not see an unhandled rejection

  const onMessage = (e: MessageEvent) => {
    if (destroyed || e.source !== iframe.contentWindow || e.origin !== 'null') return;
    const msg = openEnvelope<FromFrame>(e.data, nonce);
    if (!msg) return;
    if (msg.type === 'ready') {
      clearTimeout(readyTimer);
      post({ type: 'configure', ...settings, key });
      key = '';
      readyResolve();
      return;
    }
    const r = runs.get(Number((msg as { id?: unknown }).id));
    if (!r) return;
    if (msg.type === 'event') r.onEvent(msg.event);
    else if (msg.type === 'toolCall') {
      void r.exec(String(msg.name), msg.args && typeof msg.args === 'object' ? msg.args : {}, r.signal).then((outcome) =>
        post({ type: 'toolResult', id: msg.id, callId: msg.callId, outcome }),
      );
    } else if (msg.type === 'done') {
      runs.delete(msg.id);
      r.resolve(String(msg.text ?? ''));
    } else if (msg.type === 'error') {
      runs.delete(msg.id);
      r.reject(msg.aborted ? new FrameStopped('stopped') : new Error(String(msg.message ?? 'the agent failed')));
    }
  };
  window.addEventListener('message', onMessage);
  document.body.appendChild(iframe);

  return {
    ready,
    run(text, onEvent, exec, signal) {
      if (destroyed) return Promise.reject(new FrameStopped('stopped'));
      const id = ++nextId;
      return new Promise<string>((resolve, reject) => {
        runs.set(id, { onEvent, exec, signal, resolve, reject });
        signal.addEventListener(
          'abort',
          () => {
            post({ type: 'stop', id });
            if (runs.delete(id)) reject(new FrameStopped('stopped'));
          },
          { once: true },
        );
        post({ type: 'run', id, text });
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      key = '';
      clearTimeout(readyTimer);
      window.removeEventListener('message', onMessage);
      for (const r of runs.values()) r.reject(new FrameStopped('stopped'));
      runs.clear();
      iframe.remove();
      readyReject(new FrameStopped('stopped'));
    },
  };
}
