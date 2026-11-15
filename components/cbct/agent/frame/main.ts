// The agent frame's entry (agent-frame.html, built by scripts/agent-frame.mjs into the static
// export; docs/web-build.md section 2). It runs in an <iframe sandbox="allow-scripts"> without
// allow-same-origin, so its origin is opaque: it cannot read the viewer's storage or DOM, and
// its own CSP lets it reach only the three provider APIs and loopback. It holds the provider
// key (keyStore.ts, memory only), the adapters and the conversation, and asks the page to run
// each tool call. Messages are accepted only from the parent window, from the origin this frame
// was served from, on the channel, with the nonce from the frame's own address.
import { forgetKey, getKey, setKey } from './keyStore';
import { runTurn } from './loop';
import { CHANNEL, NONCE_RE, openEnvelope, type FromFrame, type ToFrame, type ToolOutcome } from './protocol';
import { ADAPTERS } from './providers';
import type { ToolSpec, Turn } from './providers/types';
import type { ProviderId } from '../catalog';

function start(): void {
  const nonce = new URLSearchParams(location.hash.slice(1)).get('n') ?? '';
  // served from the viewer's own origin; the sandbox makes this document's origin opaque, but
  // its address still names where it came from, and only that origin may talk to it
  const parentOrigin = new URL(location.href).origin;
  if (!NONCE_RE.test(nonce) || window.parent === window || parentOrigin === 'null') return;

  const post = (msg: FromFrame) => window.parent.postMessage({ ...msg, ch: CHANNEL, n: nonce }, parentOrigin);

  let config: { provider: ProviderId; model: string; endpoint: string; system: string; tools: ToolSpec[] } | null = null;
  const turns: Turn[] = [];
  let running: { id: number; ctrl: AbortController } | null = null;
  let nextCall = 0;
  const pendingCalls = new Map<number, (o: ToolOutcome) => void>();

  const exec = (id: number) => (name: string, args: Record<string, unknown>, signal: AbortSignal) =>
    new Promise<ToolOutcome>((resolve) => {
      const callId = ++nextCall;
      const onAbort = () => {
        pendingCalls.delete(callId);
        resolve({ text: 'stopped', isError: true });
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      pendingCalls.set(callId, (o) => {
        signal.removeEventListener('abort', onAbort);
        resolve(o);
      });
      post({ type: 'toolCall', id, callId, name, args });
    });

  async function run(id: number, text: string) {
    if (!config || running) {
      post({ type: 'error', id, message: config ? 'a request is already running' : 'the agent is not configured', aborted: false });
      return;
    }
    const ctrl = new AbortController();
    running = { id, ctrl };
    const mark = turns.length;
    try {
      const out = await runTurn({
        adapter: ADAPTERS[config.provider],
        exec: exec(id),
        system: config.system,
        tools: config.tools,
        model: config.model,
        key: getKey(),
        endpoint: config.endpoint,
        turns,
        request: text,
        signal: ctrl.signal,
        onEvent: (event) => !ctrl.signal.aborted && post({ type: 'event', id, event }),
      });
      post({ type: 'done', id, text: out });
    } catch (err) {
      // a failed or stopped request leaves no half turn behind for the next one
      turns.length = mark;
      post({ type: 'error', id, message: err instanceof Error ? err.message : String(err), aborted: ctrl.signal.aborted });
    } finally {
      if (running?.ctrl === ctrl) running = null;
    }
  }

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window.parent || e.origin !== parentOrigin) return;
    const msg = openEnvelope<ToFrame>(e.data, nonce);
    if (!msg) return;
    if (msg.type === 'configure') {
      if (config || !(msg.provider in ADAPTERS)) return; // configured once per frame
      setKey(String(msg.key ?? ''));
      config = {
        provider: msg.provider,
        model: String(msg.model ?? ''),
        endpoint: String(msg.endpoint ?? ''),
        system: String(msg.system ?? ''),
        tools: Array.isArray(msg.tools) ? msg.tools : [],
      };
    } else if (msg.type === 'run') {
      void run(Number(msg.id), String(msg.text ?? ''));
    } else if (msg.type === 'toolResult') {
      const resolve = pendingCalls.get(Number(msg.callId));
      if (!resolve) return;
      pendingCalls.delete(Number(msg.callId));
      resolve(msg.outcome);
    } else if (msg.type === 'stop') {
      if (running && running.id === Number(msg.id)) running.ctrl.abort();
    }
  });
  window.addEventListener('pagehide', forgetKey);
  post({ type: 'ready' });
}

start();
