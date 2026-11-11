#!/usr/bin/env node
// node scripts/dmg-background.mjs: the macOS disk image window, desktop/icon/dmg-background.png
// (1x) and dmg-background@2x.png, rendered with Playwright's Chromium. Run by scripts/icon.mjs
// after the icons, or alone; commit the outputs (each kept under 60 KB, checked here).
//
// The colours come from the icon of record (desktop/icon/cbctscope.svg: its ground and its
// amber) and the interface's light grey; the one sentence names the gesture, and the arrow is a
// plain line between the two icons Finder draws on top. No version, so nothing goes stale.
// electron-builder.yml repeats DMG_LAYOUT (window size, icon size, the two icon centres);
// tests/dmgWindow.test.ts keeps the two equal and every icon inside the window.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 60 * 1024;

/** the window in Finder points; x and y are icon centres from the top left */
export const DMG_LAYOUT = {
  window: { width: 640, height: 400 },
  iconSize: 112,
  app: { x: 176, y: 212 },
  applications: { x: 464, y: 212 },
};

export const DMG_SENTENCE = 'Drag CBCTScope to Applications';
/** the interface's text colour (app/globals.css --text) */
export const TEXT = '#e6e9ef';

/** ground and amber, read from the icon source */
export function iconColours(svg) {
  const ground = svg.match(/fill="(#[0-9a-fA-F]{6})"/)?.[1];
  const amber = svg.match(/stroke="(#[0-9a-fA-F]{6})"[^>]*stroke-width="\d{2,}"/)?.[1];
  if (!ground || !amber) throw new Error('cbctscope.svg: cannot read the ground fill and the amber stroke');
  return { ground, amber };
}

/** the background as SVG, in points */
export function dmgBackgroundSvg({ ground, amber }, layout = DMG_LAYOUT) {
  const { window: w, iconSize, app, applications } = layout;
  const gap = 28;
  const x1 = app.x + iconSize / 2 + gap;
  const x2 = applications.x - iconSize / 2 - gap;
  const y = app.y;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.width}" height="${w.height}" viewBox="0 0 ${w.width} ${w.height}">
<rect width="100%" height="100%" fill="${ground}"/>
<text x="${w.width / 2}" y="96" text-anchor="middle" fill="${TEXT}" font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif" font-size="22" font-weight="500">${DMG_SENTENCE}</text>
<g fill="none" stroke="${amber}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/>
<polyline points="${x2 - 9},${y - 9} ${x2},${y} ${x2 - 9},${y + 9}"/>
</g>
</svg>`;
}

export const OUTPUTS = [
  { file: path.join(root, 'desktop', 'icon', 'dmg-background.png'), scale: 1 },
  { file: path.join(root, 'desktop', 'icon', 'dmg-background@2x.png'), scale: 2 },
];

export async function renderDmgBackground(browser) {
  const svg = dmgBackgroundSvg(iconColours(readFileSync(path.join(root, 'desktop', 'icon', 'cbctscope.svg'), 'utf8')));
  const { width, height } = DMG_LAYOUT.window;
  const written = [];
  for (const { file, scale } of OUTPUTS) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } });
    await page.close();
    writeFileSync(file, png);
    const size = statSync(file).size;
    if (size > MAX_BYTES) throw new Error(`${path.relative(root, file)} is ${size} bytes, over the ${MAX_BYTES} byte budget`);
    written.push({ out: file, size });
  }
  return written;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    for (const { out, size } of await renderDmgBackground(browser)) console.log(`dmg: ${path.relative(root, out)}, ${size} bytes`);
  } finally {
    await browser.close();
  }
}
