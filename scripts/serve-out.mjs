#!/usr/bin/env node
// A tiny static server for the web build's export, for the end-to-end suite only (no new
// dependency). Loopback only.
//
//   node scripts/serve-out.mjs [dir=out] [port=4173]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? 'out');
const port = Number(process.argv[3] ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

if (!existsSync(path.join(dir, 'index.html'))) {
  console.error(`serve-out: ${dir}/index.html not found; run npm run build:web first`);
  process.exit(1);
}

/** a request path to a file inside dir, or null (traversal, missing) */
function resolve(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  const candidates = rel.endsWith('/') ? [`${rel}index.html`] : [rel, `${rel}.html`, `${rel}/index.html`];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (p !== dir && !p.startsWith(dir + path.sep)) return null;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

createServer((req, res) => {
  const file = resolve(req.url ?? '/');
  const send = (p, status) => {
    res.writeHead(status, { 'content-type': TYPES[path.extname(p)] ?? 'application/octet-stream' });
    createReadStream(p).pipe(res);
  };
  if (file) return send(file, 200);
  const notFound = path.join(dir, '404.html');
  if (existsSync(notFound)) return send(notFound, 404);
  res.writeHead(404).end('not found');
}).listen(port, '127.0.0.1', () => console.log(`serve-out: ${dir} on http://127.0.0.1:${port}`));
