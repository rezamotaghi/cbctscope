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
 * True while lib/browser/browserSource.ts is still the placeholder that throws. Volume tests
 * skip only when that holds AND the catalog really failed, so after the loader track lands a
 * catalog failure fails the suite instead of skipping it.
 */
export const LOADER_PLACEHOLDER = read('lib/browser/browserSource.ts').includes('PLACEHOLDER');

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

/** wait until the phantom renders or the catalog fails; returns which */
export async function waitForVolume(page: Page): Promise<'rendered' | 'no-catalog'> {
  const canvas = page.locator('main canvas').first();
  const failed = page.getByText('volume catalog unavailable');
  await expect(canvas.or(failed)).toBeVisible({ timeout: 60_000 });
  return (await failed.isVisible()) ? 'no-catalog' : 'rendered';
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
