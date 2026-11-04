// The browser loader and the shared helpers run in a tab (and a Web Worker): no Node API may
// leak into them, and no absolute URL either (docs/web-build.md, section 2: the web build
// talks to no host but its own origin). Source scan of lib/shared/** and lib/browser/**.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..');
const TREES = ['lib/shared', 'lib/browser'];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(rel));
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const NODE_API = [
  { name: 'node: import', re: /\bnode:/ },
  { name: 'Buffer', re: /\bBuffer\b/ },
  { name: 'process.', re: /\bprocess\./ },
  { name: 'fs', re: /\bfs\b/ },
];

describe('browser code purity', () => {
  const files = TREES.flatMap(sources);

  it('finds the trees', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('uses no Node API in lib/shared or lib/browser', () => {
    const hits: string[] = [];
    for (const f of files) {
      fs.readFileSync(path.join(ROOT, f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const p of NODE_API) if (p.re.test(line)) hits.push(`${f}:${i + 1} ${p.name}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('carries no absolute URL in lib/shared or lib/browser', () => {
    const hits: string[] = [];
    for (const f of files) {
      fs.readFileSync(path.join(ROOT, f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/\b[a-z][a-z0-9+.-]*:\/\//i.test(line)) hits.push(`${f}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
  });
});
