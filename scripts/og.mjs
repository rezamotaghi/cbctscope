#!/usr/bin/env node
// node scripts/og.mjs: the share card, public/og.png (1200 x 630), from the icon SVG of record
// (desktop/icon/cbctscope.svg), the product name and the card's two lines from the site
// constants (components/siteCard.mjs: the viewer and its author, then privacy), rendered with Playwright's Chromium. Run by
// scripts/icon.mjs after the icons, or alone; commit the output (kept under 150 KB, checked
// here). app/layout.tsx names it in the Open Graph and Twitter metadata.
import { chromium } from '@playwright/test';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CARD_CLAIM, CARD_PRIVACY } from '../components/siteCard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 150 * 1024;

export async function renderOg(browser) {
  const svg = readFileSync(path.join(root, 'desktop', 'icon', 'cbctscope.svg'), 'utf8');
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(`<html><body style="margin:0;width:1200px;height:630px;background:#0b0d10;display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#f2f2f2">
<img src="${src}" width="300" height="300" style="display:block;flex-shrink:0">
<div><div style="font-size:96px;font-weight:700;letter-spacing:-1px">CBCTScope</div>
<div style="font-size:34px;line-height:1.35;margin-top:18px;max-width:640px">${CARD_CLAIM}</div>
<div style="font-size:30px;line-height:1.35;margin-top:14px;max-width:640px">${CARD_PRIVACY}</div>
<div style="font-size:24px;margin-top:22px;color:#f2c14e">Research use only. Not a medical device.</div></div></body></html>`);
  await page.locator('img').evaluate((img) => img.decode());
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  const out = path.join(root, 'public', 'og.png');
  writeFileSync(out, png);
  const size = statSync(out).size;
  if (size > MAX_BYTES) throw new Error(`public/og.png is ${size} bytes, over the ${MAX_BYTES} byte budget`);
  return { out, size };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const browser = await chromium.launch();
  try {
    const { out, size } = await renderOg(browser);
    console.log(`og: ${path.relative(root, out)}, ${size} bytes`);
  } finally {
    await browser.close();
  }
}
