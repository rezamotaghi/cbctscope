// A tiny OpenAI-compatible chat-completions server on 127.0.0.1 for tests/e2e/agent.spec.ts:
// the in-page agent's "Local or custom endpoint" pointed at it. It answers with a scripted
// conversation, decided from the request alone:
//   no tool result yet            -> call set_view_mode { mode: 'tmj' }
//   last result from set_view_mode -> call snapshot
//   anything else                  -> a closing text
// A request whose user text contains "slow" is answered after SLOW_MS (for the Switch off
// test). Every request is recorded with its parsed body. CORS is open, as llama-server's is
// by default, so the page on another loopback port may call it.
import http from 'node:http';

export const SLOW_MS = 2500;

function reply(body) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const tools = msgs.filter((m) => m.role === 'tool');
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length);
  const lastCall = lastAssistant?.tool_calls?.at(-1)?.function?.name;
  const call = (id, name, args) => ({
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
      },
    ],
  });
  if (!tools.length) return call('call-1', 'set_view_mode', { mode: 'tmj' });
  if (lastCall === 'set_view_mode') return call('call-2', 'snapshot', {});
  return { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'TMJ mode is on screen at the current window.' } }] };
}

/** start the server on a free loopback port; resolves with its origin, the request log and close() */
export function startFakeProvider() {
  /** @type {{ method: string, path: string, origin: string | undefined, body: any }[]} */
  const requests = [];
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    // Chrome's private/local network access preflight: allowed, as a local model server would
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        /* recorded as null */
      }
      requests.push({ method: req.method ?? '', path: req.url ?? '', origin: req.headers.origin, body });
      if (req.url !== '/v1/chat/completions' || !body) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      const users = (body.messages ?? []).filter((m) => m.role === 'user' && typeof m.content === 'string');
      const slow = users.some((m) => m.content.includes('slow'));
      const send = () => {
        if (res.destroyed) return;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply(body)));
      };
      if (slow) setTimeout(send, SLOW_MS);
      else send();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
      resolve({
        origin: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r(undefined))),
      });
    });
  });
}
