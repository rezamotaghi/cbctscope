// Shared pieces of the web build's end-to-end suite.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

/** view-mode button labels, read from the source the way tests/manual.test.ts reads modes */
export function viewModeLabels(): string[] {
  const src = read('components/cbct/CbctApp.tsx');
  const start = src.indexOf('const VIEW_MODES');
  const block = src.slice(start, src.indexOf('];', start));
  return [...block.matchAll(/\[\s*'\w+',\s*'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Fail the test on any request whose origin is not the served origin (blob: and data: are
 * allowed), and on any CSP violation the page reports. Returns the collected problems.
 */
export function guardPage(page: Page, origin: string): string[] {
  const problems: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('blob:') || url.startsWith('data:')) return;
    if (new URL(url).origin !== origin) problems.push(`off-origin request: ${url}`);
  });
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) problems.push(`CSP: ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    if (/Content Security Policy/i.test(err.message)) problems.push(`CSP: ${err.message}`);
  });
  return problems;
}

/**
 * Wait until a volume is on screen. A broken catalog fails the test, never skips it: the
 * loader is real, so "volume catalog unavailable" is a defect.
 */
export async function waitForVolume(page: Page): Promise<void> {
  const canvas = page.locator('main canvas').first();
  const failed = page.getByText('volume catalog unavailable');
  await expect(canvas.or(failed)).toBeVisible({ timeout: 60_000 });
  await expect(failed, 'the volume catalog loads').toHaveCount(0);
}

/**
 * Wait until every viewer pane's canvas backing matches its size on screen, the point at which
 * the viewer has finished re-rendering for a change of layout (CbctViewport's resize effect
 * retries until it does). Opening or closing the drawer narrows or widens the panes, and under
 * software GL that re-render holds the page's main thread for seconds, which a same-origin
 * frame in the drawer shares.
 */
export async function waitForPanesSettled(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const dpr = window.devicePixelRatio || 1;
          const panes = Array.from(document.querySelectorAll<HTMLCanvasElement>('main canvas.cornerstone-canvas')).filter((c) => c.clientWidth > 0);
          // no pane found is not "settled": it would make this wait pass without checking anything
          return panes.length > 0 && panes.every((c) => Math.abs(c.width - Math.round(c.clientWidth * dpr)) <= 2 && Math.abs(c.height - Math.round(c.clientHeight * dpr)) <= 2);
        }),
      { message: 'the viewer panes take their new size', timeout: 30_000 },
    )
    .toBe(true);
}

/** true when some visible canvas in <main> holds non-uniform pixels */
export async function mainCanvasHasImage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    for (const c of Array.from(document.querySelectorAll<HTMLCanvasElement>('main canvas'))) {
      const r = c.getBoundingClientRect();
      if (r.width < 10 || r.height < 10 || !c.width || !c.height) continue;
      const probe = document.createElement('canvas');
      probe.width = Math.min(c.width, 256);
      probe.height = Math.min(c.height, 256);
      const ctx = probe.getContext('2d');
      if (!ctx) continue;
      try {
        ctx.drawImage(c, 0, 0, probe.width, probe.height);
      } catch {
        continue;
      }
      const px = ctx.getImageData(0, 0, probe.width, probe.height).data;
      let min = Infinity;
      let max = 0;
      for (let i = 0; i < px.length; i += 4) {
        const v = px[i] + px[i + 1] + px[i + 2];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max - min > 30) return true;
    }
    return false;
  });
}
