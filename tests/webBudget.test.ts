// The web build's size budget (docs/web-build.md, section 8): the measured out/ plus ten
// percent headroom. Runs when out/ exists (after `npm run build:web`; CI's web job runs it
// right after the build). Raising the budget is a decision, made in this file, with a reason.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Measured 2026-11-04 after the manual's pages joined the export (docs/web-build.md, section
 * 13): 10_365_588 bytes, of which manual/ is 2_426_806 (its nine WebP stills about 2 MB). The
 * integration pass's figure, 7_791_978 with the real browser loader, is superseded; the pages
 * are a deliberate addition, so the budget moves with them.
 *
 * Re-measured 2026-11-11 after the manual's stills were recaptured on the redesigned interface
 * (the nine WebP stills 2_120_310 bytes, up 30_564): 10_588_932 bytes, of which manual/ is
 * 2_501_889.
 */
const MEASURED = 10_588_932;
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
