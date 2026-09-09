// Shrink-only size cap on AGENTS.md: it is read into every agent session, so it stays
// small and current-only. When it grows past the cap, trim the file; never raise the number.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CAP = 6528;

describe('AGENTS.md', () => {
  it(`stays within its ${CAP}-byte cap`, () => {
    const size = statSync(fileURLToPath(new URL('../AGENTS.md', import.meta.url))).size;
    expect(size, 'AGENTS.md grew past its cap: trim it, never raise the cap').toBeLessThanOrEqual(CAP);
  });
});

describe('Start CBCTScope.bat', () => {
  it('keeps CRLF line endings, and .gitattributes stops git from rewriting them', () => {
    // cmd.exe batch files are CRLF by convention; the GitHub ZIP ships the bytes as committed,
    // so the file itself carries the endings and *.bat is marked -text (no normalization).
    const bat = readFileSync(fileURLToPath(new URL('../Start CBCTScope.bat', import.meta.url)), 'latin1');
    const lines = bat.split('\n');
    expect(lines.length).toBeGreaterThan(5);
    for (const [i, line] of lines.slice(0, -1).entries()) expect(line.endsWith('\r'), `line ${i + 1} lacks CR`).toBe(true);
    const attrs = readFileSync(fileURLToPath(new URL('../.gitattributes', import.meta.url)), 'utf8');
    expect(attrs).toMatch(/^\*\.bat -text$/m);
  });
});
