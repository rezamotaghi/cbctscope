// The third of the web build's three no-upload checks (docs/web-build.md, section 2): browser
// code names no absolute URL it could send a request to. Two rules over components/** and
// lib/browser/**, comments stripped:
//   1. no fetch( / EventSource( / new URL( call carries an absolute URL or a link constant;
//   2. every absolute URL literal is on the list below: the link constants of the header
//      (links the reader clicks, never requests the page makes) and the SVG namespace.
// A new absolute URL fails until it is reviewed and listed here.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const ALLOWED = new Set([
  'https://github.com/rezamotaghi/cbctscope/blob/main/', // DOCS_URL in CbctApp.tsx
  'https://github.com/rezamotaghi/cbctscope', // REPO_URL in CbctApp.tsx
  'https://github.com/rezamotaghi/cbctscope/releases', // RELEASES_URL in CbctApp.tsx (the desktop app)
  'http://www.w3.org/2000/svg', // the SVG namespace of a snapshot's annotation layer, not a request
]);
const LINK_CONSTANTS = ['DOCS_URL', 'REPO_URL', 'RELEASES_URL'];

/** the agent's provider bases and local presets: allowed in this one constants module only */
const AGENT_HOSTS_FILE = path.join('components', 'cbct', 'agent', 'providers', 'hosts.ts');
const AGENT_HOSTS = new Set([
  'https://api.anthropic.com',
  'https://api.openai.com',
  'https://generativelanguage.googleapis.com',
  'http://127.0.0.1:8080', // llama-server preset
  'http://127.0.0.1:11434', // Ollama preset
  'http://127.0.0.1:1234', // LM Studio preset
]);
/** the CSP's connect-src source expressions: policy, never a request (tests/webShell.test.ts pins them) */
const CSP_FILE = path.join('components', 'webCsp.mjs');
const CSP_SOURCES = new Set([
  'https://api.anthropic.com',
  'https://api.openai.com',
  'https://generativelanguage.googleapis.com',
  'http://127.0.0.1:*',
  'http://localhost:*',
]);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(rel);
  }
  return out;
}

/** block comments (JSX ones included) and whole-line // comments removed */
const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

const files = [...sources('components'), ...sources('lib/browser')];

describe('browser code names no off-origin URL', () => {
  it('found the browser sources', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain(path.join('components', 'cbct', 'CbctApp.tsx'));
  });

  it('no request call carries an absolute URL or a link constant', () => {
    const hits: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(path.join(root, f), 'utf8'));
      for (const m of code.matchAll(/\b(fetch|EventSource|new URL)\s*\(([^)]*)/g)) {
        const arg = m[2];
        if (/https?:\/\//.test(arg) || LINK_CONSTANTS.some((c) => new RegExp(`\\b${c}\\b`).test(arg))) {
          hits.push(`${f}: ${m[0].trim()}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it('every absolute URL literal is a reviewed link or namespace', () => {
    const hits: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(path.join(root, f), 'utf8'));
      for (const m of code.matchAll(/['"`](https?:\/\/[^'"`]*)['"`]/g)) {
        if (ALLOWED.has(m[1])) continue;
        if (f === AGENT_HOSTS_FILE && AGENT_HOSTS.has(m[1])) continue;
        if (f === CSP_FILE && CSP_SOURCES.has(m[1])) continue;
        hits.push(`${f}: ${m[1]}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the agent hosts module holds exactly the reviewed provider bases and presets', () => {
    const code = stripComments(readFileSync(path.join(root, AGENT_HOSTS_FILE), 'utf8'));
    const urls = [...code.matchAll(/['"`](https?:\/\/[^'"`]*)['"`]/g)].map((m) => m[1]);
    expect(new Set(urls)).toEqual(AGENT_HOSTS);
  });
});
