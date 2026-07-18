// Network trust boundary. CBCTScope is a loopback-only tool: every request must come
// from this machine's own browser talking to localhost. Two attacks this blocks:
//   - DNS rebinding: attacker.com re-resolves to 127.0.0.1, making a victim's browser
//     issue same-origin (readable!) requests to the viewer. The Host header still says
//     attacker.com, so a strict Host allowlist kills it.
//   - Cross-site POSTs (CSRF): a hostile page fires "simple" POSTs at the API. Any
//     request carrying a non-loopback Origin is rejected.
// Defense in depth with the -H 127.0.0.1 bind in package.json; keep both.
import { NextRequest, NextResponse } from 'next/server';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function isLoopback(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  // Host may carry a port ("127.0.0.1:3810"); IPv6 keeps its brackets ("[::1]:3810").
  const host = hostHeader.startsWith('[')
    ? hostHeader.replace(/\]:\d+$/, ']')
    : hostHeader.replace(/:\d+$/, '');
  return LOOPBACK_HOSTS.has(host);
}

export function middleware(req: NextRequest) {
  if (!isLoopback(req.headers.get('host'))) {
    return new NextResponse('CBCTScope only answers to localhost.', { status: 403 });
  }
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      if (!isLoopback(new URL(origin).host)) {
        return new NextResponse('Cross-origin requests are not allowed.', { status: 403 });
      }
    } catch {
      return new NextResponse('Malformed Origin.', { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: '/:path*' };
