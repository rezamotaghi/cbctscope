// The repo server's trust boundary (middleware.ts): the same cases as the desktop bridge's
// (tests/desktopBridge.test.ts), against the middleware function itself.
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from '../middleware';

const PORT = 3810;

function status(path: string, headers: Record<string, string> = {}, method = 'GET'): number {
  const h = new Headers({ host: `127.0.0.1:${PORT}`, ...headers });
  const res = middleware(new NextRequest(`http://127.0.0.1:${PORT}${path}`, { method, headers: h }));
  return res.status;
}

describe('middleware.ts', () => {
  it('refuses a rebinding Host', () => {
    expect(status('/', { host: 'attacker.example:3810' })).toBe(403);
    expect(status('/api/agent/command', { host: '127.0.0.1.evil.com' }, 'POST')).toBe(403);
  });

  it('refuses a cross-site GET to the agent stream (the reproduction)', () => {
    expect(status('/api/agent/events', { 'sec-fetch-site': 'cross-site' })).toBe(403);
    expect(status('/api/agent/events', { 'sec-fetch-site': 'same-site' })).toBe(403);
    expect(status('/api/agent/events')).toBe(403); // no browser, no stream
    expect(status('/api/agent/events', { 'sec-fetch-site': 'same-origin' })).toBe(200);
  });

  it('refuses any cross-site request and lets the page and a typed address through', () => {
    expect(status('/', { 'sec-fetch-site': 'cross-site' })).toBe(403);
    expect(status('/api/agent/command', { 'sec-fetch-site': 'same-site' }, 'POST')).toBe(403);
    expect(status('/', { 'sec-fetch-site': 'none' })).toBe(200);
    expect(status('/', { 'sec-fetch-site': 'same-origin' })).toBe(200);
  });

  it('accepts a header-less POST (the MCP server and the smoke check use Node fetch)', () => {
    expect(status('/api/agent/command', {}, 'POST')).toBe(200);
    expect(status('/api/agent/result', {}, 'POST')).toBe(200);
  });

  it('wants the exact own origin, not any loopback origin', () => {
    expect(status('/api/agent/command', { origin: `http://127.0.0.1:${PORT + 1}` }, 'POST')).toBe(403);
    expect(status('/', { origin: `http://localhost:${PORT}` })).toBe(403);
    expect(status('/', { origin: `https://127.0.0.1:${PORT}` })).toBe(403);
    expect(status('/', { origin: 'null' })).toBe(403);
    expect(status('/', { origin: 'not a url' })).toBe(403);
    expect(status('/api/agent/command', { origin: `http://127.0.0.1:${PORT}` }, 'POST')).toBe(200);
  });
});
