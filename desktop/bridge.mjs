// The desktop app's bridge host (docs/web-build.md, sections 1 and 12). One loopback HTTP
// server that does two jobs:
//   1. serves the static web build (out/) to the app's window, and
//   2. carries the agent bridge of the repo, so mcp/server.mjs and the MCPB bundle work
//      unchanged: /api/agent/command, /api/agent/events (SSE), /api/agent/result with the
//      semantics of lib/server/agentBus.ts (single viewer, eviction, pending map, timeouts),
//      plus the two catalog reads the MCP server makes (/api/cbct, /api/cbct/<id>), answered
//      by the page over the same channel because the catalog lives in the page.
// Every request passes the Host and Origin checks of middleware.ts first.
//
// MDR fence: the bridge relays navigation and visualization verbs and catalog geometry. It
// computes nothing, stores nothing, and has no route that takes a file path: scans enter
// through the page's own picker, as in the web build.
//
// Plain Node, no dependencies, so the Electron main process loads it as is.
import crypto from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export const DEFAULT_PORT = 3810;
const MAX_BODY = 64 * 1024 * 1024; // a snapshot result is a PNG data URL of a few MB

// ---------------------------------------------------------------- the loopback check
// middleware.ts, line for line: a strict Host allowlist (DNS rebinding) and any Origin, when
// present, must be loopback too (cross-site POSTs).
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function isLoopback(hostHeader) {
  if (!hostHeader) return false;
  const host = hostHeader.startsWith('[') ? hostHeader.replace(/\]:\d+$/, ']') : hostHeader.replace(/:\d+$/, '');
  return LOOPBACK_HOSTS.has(host);
}

/** null when the request may pass, else the 403 text middleware.ts answers with */
export function loopbackRefusal(headers) {
  if (!isLoopback(headers.host ?? null)) return 'CBCTScope only answers to localhost.';
  const origin = headers.origin;
  if (origin) {
    try {
      if (!isLoopback(new URL(origin).host)) return 'Cross-origin requests are not allowed.';
    } catch {
      return 'Malformed Origin.';
    }
  }
  return null;
}

// ---------------------------------------------------------------- the bus (agentBus.ts)
export function createBus() {
  /** subscriber -> its eviction hook (single-viewer contract: at most one entry) */
  const subscribers = new Map();
  const pending = new Map();

  return {
    /** the newest subscription IS the viewer: every earlier one is evicted */
    subscribe(fn, onEvict = () => {}) {
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
    },
    hasViewer: () => subscribers.size > 0,
    dispatch(verb, args, timeoutMs = 15_000) {
      if (!subscribers.size) {
        return Promise.resolve({ ok: false, error: 'no viewer connected: the CBCTScope window is not open or still loading' });
      }
      const id = crypto.randomBytes(8).toString('hex');
      const cmd = { id, verb, args };
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: `viewer did not answer within ${timeoutMs / 1000}s` });
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        for (const fn of subscribers.keys()) fn(cmd);
      });
    },
    resolve(id, ok, result, error) {
      const p = pending.get(id);
      if (!p) return false;
      pending.delete(id);
      clearTimeout(p.timer);
      p.resolve({ ok, result, error });
      return true;
    },
    /** quit: answer every waiting command, close every stream */
    close() {
      for (const [id, p] of [...pending]) {
        pending.delete(id);
        clearTimeout(p.timer);
        p.resolve({ ok: false, error: 'the CBCTScope app is quitting' });
      }
      for (const [fn, evict] of [...subscribers]) {
        subscribers.delete(fn);
        try {
          evict();
        } catch {
          /* gone */
        }
      }
    },
  };
}

// ---------------------------------------------------------------- static files
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** the file a URL path names inside root, or null; never a directory, never outside root */
export function resolveStatic(root, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  const full = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  // a directory serves its index.html; an extensionless page its .html (Next's export layout)
  for (const candidate of [full, path.join(full, 'index.html'), full + '.html']) {
    if ((candidate === root || candidate.startsWith(root + path.sep)) && isFile(candidate)) return candidate;
  }
  return null;
}

function serveStatic(root, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed.', { Allow: 'GET, HEAD' });
  const urlPath = new URL(req.url, 'http://127.0.0.1').pathname;
  let file = resolveStatic(root, urlPath);
  let status = 200;
  if (!file) {
    status = 404;
    file = isFile(path.join(root, '404.html')) ? path.join(root, '404.html') : null;
    if (!file) return send(res, 404, 'text/plain; charset=utf-8', 'Not found.');
  }
  const ext = path.extname(file).toLowerCase();
  const size = statSync(file).size;
  res.writeHead(status, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Length': size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': urlPath.startsWith('/_next/static/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------- helpers
function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}
const sendJson = (res, status, value) => send(res, status, 'application/json', JSON.stringify(value));

/** the parsed JSON body, or undefined when it is not JSON (the routes answer 400) */
function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(undefined);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

// ---------------------------------------------------------------- the routes
function events(bus, req, res, log) {
  log('viewer connected (agent stream)');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Content-Type-Options': 'nosniff',
  });
  const write = (data) => {
    if (!res.writableEnded) res.write(data);
  };
  write(': connected\n\n');
  let heartbeat = null;
  const unsubscribe = bus.subscribe(
    (cmd) => write(`data: ${JSON.stringify(cmd)}\n\n`),
    // evicted by a newer viewer: tell this one, then close its stream
    () => {
      write('event: evicted\ndata: {}\n\n');
      if (heartbeat) clearInterval(heartbeat);
      res.end();
    },
  );
  heartbeat = setInterval(() => write(': ping\n\n'), 25_000);
  res.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });
}

async function command(bus, req, res) {
  if (req.method === 'GET') return sendJson(res, 200, { viewer: bus.hasViewer() });
  if (req.method !== 'POST') return send(res, 405, 'text/plain', '', { Allow: 'GET, POST' });
  const body = await readJson(req);
  if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'bad request' });
  if (typeof body.verb !== 'string') return sendJson(res, 400, { ok: false, error: 'verb required' });
  const outcome = await bus.dispatch(
    body.verb,
    body.args ?? {},
    Math.min(60_000, Math.max(1_000, Number(body.timeoutMs) || 15_000)),
  );
  sendJson(res, outcome.ok ? 200 : 502, outcome);
}

async function result(bus, req, res) {
  if (req.method !== 'POST') return send(res, 405, 'text/plain', '', { Allow: 'POST' });
  const body = await readJson(req);
  if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'bad request' });
  if (typeof body.id !== 'string') return sendJson(res, 400, { error: 'id required' });
  const known = bus.resolve(body.id, body.ok !== false, body.result, body.error);
  sendJson(res, 200, { ok: true, known });
}

/** the MCP server's catalog reads, asked of the page (the catalog lives in the tab) */
async function catalog(bus, req, res, anon) {
  if (req.method !== 'GET') return send(res, 405, 'text/plain', '', { Allow: 'GET' });
  const out = anon === null ? await bus.dispatch('source.list', {}) : await bus.dispatch('source.meta', { id: anon });
  if (!out.ok) return sendJson(res, anon === null ? 502 : 404, { error: out.error || 'catalog unavailable' });
  sendJson(res, 200, out.result);
}

const NO_PATH_ROUTE =
  'the desktop app opens scans through its own picker only: ask the human to choose Open DICOMDIR or DICOM folder in the CBCTScope window, then call list_volumes';

/**
 * Start the bridge. Binds 127.0.0.1 on `port` (3810, the MCP server's default); when that is
 * taken, on a free port, and `fallback` is true in the result.
 * @param {{ root: string, port?: number, log?: (line: string) => void }} opts
 */
export async function startBridge({ root, port = DEFAULT_PORT, log = () => {} }) {
  root = path.resolve(root);
  const bus = createBus();
  const server = http.createServer((req, res) => {
    const refusal = loopbackRefusal(req.headers);
    if (refusal) {
      log(`403 ${req.method} ${req.url} (${refusal})`);
      return send(res, 403, 'text/plain; charset=utf-8', refusal);
    }
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname.startsWith('/api/')) log(`${req.method} ${pathname}`);
    const route = async () => {
      if (pathname === '/api/agent/events') return events(bus, req, res, log);
      if (pathname === '/api/agent/command') return command(bus, req, res);
      if (pathname === '/api/agent/result') return result(bus, req, res);
      if (pathname === '/api/cbct') return catalog(bus, req, res, null);
      if (pathname === '/api/cbct/source' || pathname === '/api/cbct/source/pick') return sendJson(res, 501, { error: NO_PATH_ROUTE });
      const meta = /^\/api\/cbct\/([A-Za-z0-9_-]+)$/.exec(pathname);
      if (meta) return catalog(bus, req, res, meta[1]);
      if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });
      return serveStatic(root, req, res);
    };
    route().catch((err) => {
      log(`500 ${req.method} ${pathname}: ${err?.message ?? err}`);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
  // SSE streams are long-lived; Node's default request timeout would cut them
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

  const listen = (p) =>
    new Promise((resolve, reject) => {
      const onError = (err) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, '127.0.0.1');
    });

  let fallback = false;
  try {
    await listen(port);
  } catch (err) {
    if (err?.code !== 'EADDRINUSE') throw err;
    fallback = true;
    await listen(0);
  }
  const bound = server.address().port;
  const url = `http://127.0.0.1:${bound}`;
  log(`bridge on ${url}${fallback ? ` (port ${port} was taken)` : ''}, serving ${root}`);

  return {
    port: bound,
    url,
    fallback,
    close: () =>
      new Promise((resolve) => {
        bus.close();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
