// The web build's size budget (docs/web-build.md, section 8): the measured out/ plus ten
// percent headroom. Runs when out/ exists (after `npm run build:web`; CI's web job runs it
// right after the build). Raising the budget is a decision, made in this file, with a reason.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Measured 2026-11-04 with the real browser loader (integration pass, Next 15.5.22):
 * 7_791_978 bytes. The shell track's first figure, 7_733_430, was taken on the placeholder
 * source and is superseded.
 */
const MEASURED = 7_791_978;
const BUDGET = Math.round(MEASURED * 1.1);

const out = path.join(process.cwd(), 'out');

function bytes(dir: string): number {
  let sum = 0;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const s = statSync(p);
    sum += s.isDirectory() ? bytes(p) : s.size;
  }
  return sum;
}

describe('the web build', () => {
  it.skipIf(!existsSync(path.join(out, 'index.html')))(`out/ stays within ${BUDGET} bytes`, () => {
    expect(bytes(out)).toBeLessThanOrEqual(BUDGET);
  });
});
