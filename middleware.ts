// Network trust boundary. CBCTScope is a loopback-only tool: every request must come
// from this machine's own browser talking to localhost, or from a local Node client (the MCP
// server, the smoke check). Attacks this blocks:
//   - DNS rebinding: attacker.com re-resolves to 127.0.0.1, making a victim's browser
//     issue same-origin (readable!) requests to the viewer. The Host header still says
//     attacker.com, so a strict Host allowlist kills it.
//   - Cross-site requests (CSRF, and a GET that subscribes to the agent stream and evicts the
//     viewer): a browser sends Sec-Fetch-Site, and anything but same-origin or none (a typed
//     address) is refused, GETs included. This also refuses pages served by any other local
//     web server, whose requests are same-site at best.
//   - An Origin, when sent, must be this server's own origin exactly: scheme, loopback host
//     and port, not merely any loopback origin.
//   - /api/agent/events additionally requires Sec-Fetch-Site: same-origin: the page's
//     EventSource sends it, and no Node client ever needs the stream.
// mcp/server.mjs and scripts/mcp-smoke.mjs use Node's fetch, which sends neither header, so
// the command and result routes keep accepting header-less requests.
// desktop/bridge.mjs applies the same rules (loopbackRefusal); tests/middleware.test.ts and
// tests/desktopBridge.test.ts pin both.
// Defense in depth with the -H 127.0.0.1 bind in package.json; keep both.
import { NextRequest, NextResponse } from 'next/server';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const EVENTS_PATH = '/api/agent/events';

export function isLoopback(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  // Host may carry a port ("127.0.0.1:3810"); IPv6 keeps its brackets ("[::1]:3810").
  const host = hostHeader.startsWith('[')
    ? hostHeader.replace(/\]:\d+$/, ']')
    : hostHeader.replace(/:\d+$/, '');
  return LOOPBACK_HOSTS.has(host);
}

/** null when the request may pass, else the 403 text */
export function loopbackRefusal(headers: Headers, pathname: string): string | null {
  const host = headers.get('host');
  if (!isLoopback(host)) return 'CBCTScope only answers to localhost.';
  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin' && site !== 'none') return 'Cross-site requests are not allowed.';
  const origin = headers.get('origin');
  if (origin !== null && origin !== `http://${host}`) return 'Cross-origin requests are not allowed.';
  if (pathname === EVENTS_PATH && site !== 'same-origin') return 'The agent stream is for the viewer page only.';
  return null;
}

export function middleware(req: NextRequest) {
  const refusal = loopbackRefusal(req.headers, req.nextUrl.pathname);
  if (refusal) return new NextResponse(refusal, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: '/:path*' };
