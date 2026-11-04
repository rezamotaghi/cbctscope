// The desktop app's bridge host (desktop/bridge.mjs): the loopback checks of middleware.ts,
// the static server's confinement and MIME types, and the agentBus contract (single viewer,
// eviction, the pending map, the round trip) over real HTTP on an ephemeral port.
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isLoopback, resolveStatic, startBridge } from '../desktop/bridge.mjs';

let dir: string;
let root: string;
let bridge: { port: number; close: () => Promise<void> };

interface Res {
  status: number;
  type: string;
  body: string;
}

function req(p: string, opts: { method?: string; host?: string; origin?: string; body?: unknown } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: opts.host ?? `127.0.0.1:${bridge.port}` };
    if (opts.origin) headers.Origin = opts.origin;
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    if (payload) headers['Content-Type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port: bridge.port, path: p, method: opts.method ?? 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

/** an SSE subscriber: collects command events and whether it was evicted */
function subscribe(): Promise<{ commands: { id: string; verb: string; args: unknown }[]; evicted: () => boolean; close: () => void }> {
  return new Promise((resolve) => {
    const commands: { id: string; verb: string; args: unknown }[] = [];
    let evicted = false;
    const r = http.get(
      { host: '127.0.0.1', port: bridge.port, path: '/api/agent/events', headers: { Host: `localhost:${bridge.port}` } },
      (res) => {
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (block.startsWith('event: evicted')) evicted = true;
            else if (block.startsWith('data: ')) commands.push(JSON.parse(block.slice(6)));
            else if (block === ': connected') resolve({ commands, evicted: () => evicted, close: () => r.destroy() });
          }
        });
      },
    );
  });
}

const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10));
};

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'cbctscope-bridge-'));
  root = path.join(dir, 'out');
  mkdirSync(path.join(root, '_next'), { recursive: true });
  mkdirSync(path.join(root, 'sub'));
  writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>index</title>');
  writeFileSync(path.join(root, '404.html'), 'missing');
  writeFileSync(path.join(root, '_next', 'codec.wasm'), Buffer.from([0, 97, 115, 109]));
  writeFileSync(path.join(root, 'sub', 'index.html'), 'sub');
  writeFileSync(path.join(dir, 'secret.txt'), 'outside');
  bridge = await startBridge({ root, port: 0 });
});

afterAll(async () => {
  await bridge?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('loopback checks (middleware.ts)', () => {
  it('accepts the loopback hosts only', () => {
    for (const h of ['127.0.0.1', 'localhost:3810', '[::1]:3810', '127.0.0.1:1']) expect(isLoopback(h)).toBe(true);
    for (const h of [null, '', 'evil.com', 'evil.com:3810', '127.0.0.1.evil.com', '[::2]:3810']) expect(isLoopback(h)).toBe(false);
  });

  it('refuses a rebinding Host and a cross-site Origin on every route', async () => {
    expect((await req('/', { host: 'attacker.example:3810' })).status).toBe(403);
    expect((await req('/api/agent/command', { host: 'attacker.example' })).status).toBe(403);
    const cross = await req('/api/agent/command', { method: 'POST', origin: 'https://attacker.example', body: { verb: 'get_state' } });
    expect(cross.status).toBe(403);
    expect((await req('/', { origin: 'not a url' })).status).toBe(403);
    expect((await req('/', { origin: `http://localhost:${bridge.port}` })).status).toBe(200);
  });
});

describe('static files', () => {
  it('serves the page and the codec with their types', async () => {
    const page = await req('/');
    expect(page.status).toBe(200);
    expect(page.type).toMatch(/^text\/html/);
    expect((await req('/_next/codec.wasm')).type).toBe('application/wasm');
    expect((await req('/sub')).body).toBe('sub');
  });

  it('stays inside out/ and lists no directory', async () => {
    expect(resolveStatic(root, '/../secret.txt')).toBeNull();
    expect(resolveStatic(root, '/%2e%2e/secret.txt')).toBeNull();
    expect(resolveStatic(root, '/..%5csecret.txt')).toBeNull();
    expect(resolveStatic(root, '/_next/')).toBeNull();
    const up = await req('/%2e%2e/secret.txt');
    expect(up.status).toBe(404);
    expect(up.body).not.toContain('outside');
    expect((await req('/_next/')).status).toBe(404);
  });
});

describe('the agent bridge (agentBus.ts contract)', () => {
  it('answers 502 with no viewer, and validates the body', async () => {
    expect(JSON.parse((await req('/api/agent/command')).body)).toEqual({ viewer: false });
    const none = await req('/api/agent/command', { method: 'POST', body: { verb: 'get_state' } });
    expect(none.status).toBe(502);
    expect(JSON.parse(none.body).ok).toBe(false);
    expect((await req('/api/agent/command', { method: 'POST', body: {} })).status).toBe(400);
    expect((await req('/api/agent/result', { method: 'POST', body: {} })).status).toBe(400);
    expect((await req('/api/cbct/source', { method: 'POST', body: { path: '/x' } })).status).toBe(501);
  });

  it('round-trips a command, evicts the older viewer, and times out', async () => {
    const a = await subscribe();
    const pending = req('/api/agent/command', { method: 'POST', body: { verb: 'get_state', args: { x: 1 } } });
    await until(() => a.commands.length === 1);
    const cmd = a.commands[0];
    expect(cmd.verb).toBe('get_state');
    const ack = await req('/api/agent/result', { method: 'POST', body: { id: cmd.id, ok: true, result: { s: 1 } } });
    expect(JSON.parse(ack.body)).toEqual({ ok: true, known: true });
    const out = await pending;
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ ok: true, result: { s: 1 } });

    const b = await subscribe();
    await until(() => a.evicted());
    expect(a.evicted()).toBe(true);
    expect(b.evicted()).toBe(false);

    // the catalog read goes to the newest viewer only
    const list = req('/api/cbct');
    await until(() => b.commands.length === 1);
    expect(a.commands.length).toBe(1);
    expect(b.commands[0].verb).toBe('source.list');
    await req('/api/agent/result', { method: 'POST', body: { id: b.commands[0].id, ok: true, result: { volumes: [] } } });
    expect(JSON.parse((await list).body)).toEqual({ volumes: [] });

    const late = await req('/api/agent/command', { method: 'POST', body: { verb: 'get_state', timeoutMs: 1000 } });
    expect(late.status).toBe(502);
    expect(JSON.parse(late.body).error).toMatch(/within 1s/);
    const stale = await req('/api/agent/result', { method: 'POST', body: { id: b.commands[1].id, ok: true } });
    expect(JSON.parse(stale.body).known).toBe(false);
    a.close();
    b.close();
  });
});
