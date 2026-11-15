#!/usr/bin/env node
// node scripts/og.mjs: the share card, public/og-card.png (1200 x 630), from the icon SVG of record
// (desktop/icon/cbctscope.svg), the product name and the card's three lines from the site
// constants (components/siteCard.mjs: the viewer and its author, privacy, the agent), rendered with Playwright's Chromium. Run by
// scripts/icon.mjs after the icons, or alone; commit the output (kept under 150 KB, checked
// here). app/layout.tsx names it in the Open Graph and Twitter metadata.
import { chromium } from '@playwright/test';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CARD_AGENT, CARD_CLAIM, CARD_PRIVACY } from '../components/siteCard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 150 * 1024;

export async function renderOg(browser) {
  const svg = readFileSync(path.join(root, 'desktop', 'icon', 'cbctscope.svg'), 'utf8');
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(`<html><body style="margin:0;width:1200px;height:630px;background:#0b0d10;display:flex;align-items:center;gap:52px;padding:0 84px;box-sizing:border-box;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#f2f2f2">
<img src="${src}" width="264" height="264" style="display:block;flex-shrink:0">
<div style="max-width:716px"><div style="font-size:88px;font-weight:700;letter-spacing:-1px;line-height:1">CBCTScope</div>
<div style="font-size:33px;line-height:1.3;margin-top:26px;text-wrap:balance">${CARD_CLAIM}</div>
<div style="font-size:25px;line-height:1.4;margin-top:22px;color:#c3c9d2">${CARD_PRIVACY}</div>
<div style="font-size:25px;line-height:1.4;margin-top:6px;color:#c3c9d2;white-space:nowrap">${CARD_AGENT}</div>
<div style="font-size:22px;margin-top:26px;color:#f2c14e">Research use only. Not a medical device.</div></div></body></html>`);
  await page.locator('img').evaluate((img) => img.decode());
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  const out = path.join(root, 'public', 'og-card.png');
  writeFileSync(out, png);
  const size = statSync(out).size;
  if (size > MAX_BYTES) throw new Error(`public/og-card.png is ${size} bytes, over the ${MAX_BYTES} byte budget`);
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
