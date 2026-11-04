// The web build's size budget (docs/web-build.md, section 8): the first measured out/ plus ten
// percent headroom. Runs when out/ exists (after `npm run build:web`; CI's web job runs it
// right after the build). Raising the budget is a decision, made in this file, with a reason.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** first measured on 2026-11-04 (shell track, Next 15.5.22, placeholder browser source) */
const FIRST_MEASURED = 7_733_430;
const BUDGET = Math.round(FIRST_MEASURED * 1.1);

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
