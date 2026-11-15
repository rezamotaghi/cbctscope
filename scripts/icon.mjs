#!/usr/bin/env node
// node scripts/icon.mjs [file.svg]: every app and web icon from one SVG source.
//
// With a path, that SVG (viewBox 0 0 1024 1024, the macOS grid) is copied to
// desktop/icon/cbctscope.svg, the source of record, and rendered; without one, the source of
// record is rendered again. `npm run icon -- path/to/pick.svg` drops a new mark in.
//
//   desktop/icon/icon.png    1024 px, the macOS grid (the 824 px tile inside a 1024 canvas)
//   desktop/icon/icon.icns   macOS, through an .iconset folder and `iconutil` (macOS only;
//                            elsewhere the committed file is kept and a line says so)
//   desktop/icon/icon.ico    Windows, PNG-compressed entries at 16, 32, 48 and 256 px
//   app/icon.svg             the web favicon (Next file convention), the tile cropped full bleed
//   app/apple-icon.png       180 px touch icon (Next file convention), opaque, full bleed
//   public/og-card.png            the 1200 x 630 share card (scripts/og.mjs)
//   desktop/icon/dmg-background.png, @2x   the macOS disk image window (scripts/dmg-background.mjs)
//
// Rendering is Playwright's Chromium (already a dev dependency for the end-to-end suite).
// Rerun after any change to the SVG and commit the outputs; electron-builder.yml points at the
// icns and the ico.
import { chromium } from '@playwright/test';
import { renderDmgBackground } from './dmg-background.mjs';
import { renderOg } from './og.mjs';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = path.join(root, 'desktop', 'icon');
const record = path.join(iconDir, 'cbctscope.svg');
const arg = process.argv[2];
mkdirSync(iconDir, { recursive: true });
if (arg && path.resolve(arg) !== record) copyFileSync(path.resolve(arg), record);
const source = readFileSync(record, 'utf8');
if (!source.includes('viewBox="0 0 1024 1024"')) throw new Error('cbctscope.svg must use viewBox="0 0 1024 1024"');

// the tile alone, full bleed: the 824 px rounded square is the whole image (favicon, ico, touch)
const tile = source.replace('viewBox="0 0 1024 1024"', 'viewBox="100 100 824 824"');

const browser = await chromium.launch();
const page = await browser.newPage();

/** the SVG rasterised at size x size; background is a CSS colour or transparent */
async function render(svg, size, background = 'transparent') {
  await page.setViewportSize({ width: size, height: size });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await page.setContent(
    `<html><body style="margin:0;background:${background}"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`,
  );
  await page.locator('img').evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: background === 'transparent' });
}

const written = [];
const write = (file, data) => {
  writeFileSync(file, data);
  written.push(file);
};

// 1. the 1024 master
write(path.join(iconDir, 'icon.png'), await render(source, 1024));

// 2. icns: the ten iconset members, then iconutil
if (process.platform === 'darwin') {
  const tmp = mkdtempSync(path.join(tmpdir(), 'cbctscope-icon-'));
  const set = path.join(tmp, 'icon.iconset');
  mkdirSync(set);
  for (const base of [16, 32, 128, 256, 512]) {
    writeFileSync(path.join(set, `icon_${base}x${base}.png`), await render(source, base));
    writeFileSync(path.join(set, `icon_${base}x${base}@2x.png`), await render(source, base * 2));
  }
  const r = spawnSync('iconutil', ['-c', 'icns', set, '-o', path.join(iconDir, 'icon.icns')], { stdio: 'inherit' });
  rmSync(tmp, { recursive: true, force: true });
  if (r.status !== 0) throw new Error('iconutil failed');
  written.push(path.join(iconDir, 'icon.icns'));
} else {
  console.log('icon: icon.icns needs macOS iconutil; the committed file is kept');
}

// 3. ico: ICONDIR, one 16-byte ICONDIRENTRY per image, then the PNG payloads
const icoSizes = [16, 32, 48, 256];
const pngs = [];
for (const s of icoSizes) pngs.push(await render(tile, s));
const head = Buffer.alloc(6 + 16 * pngs.length);
head.writeUInt16LE(0, 0); // reserved
head.writeUInt16LE(1, 2); // type: icon
head.writeUInt16LE(pngs.length, 4);
let offset = head.length;
pngs.forEach((png, i) => {
  const e = 6 + 16 * i;
  const s = icoSizes[i];
  head.writeUInt8(s >= 256 ? 0 : s, e); // width, 0 means 256
  head.writeUInt8(s >= 256 ? 0 : s, e + 1); // height
  head.writeUInt8(0, e + 2); // palette size
  head.writeUInt8(0, e + 3); // reserved
  head.writeUInt16LE(1, e + 4); // colour planes
  head.writeUInt16LE(32, e + 6); // bits per pixel
  head.writeUInt32LE(png.length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
write(path.join(iconDir, 'icon.ico'), Buffer.concat([head, ...pngs]));

// 4. the web build's icons, by Next's file conventions (the exported HTML links both)
write(path.join(root, 'app', 'icon.svg'), tile);
// the touch icon is opaque: the tile's corners take the first solid fill in the source (its ground)
const ground = source.match(/fill="(#[0-9a-fA-F]{3,8})"/)?.[1] ?? '#000000';
write(path.join(root, 'app', 'apple-icon.png'), await render(tile, 180, ground));

// 6. the share card (scripts/og.mjs), from the same SVG
const og = await renderOg(browser);
written.push(og.out);

// 7. the disk image window (scripts/dmg-background.mjs), from the same SVG's colours
for (const { out } of await renderDmgBackground(browser)) written.push(out);

await browser.close();
for (const f of written) console.log(`icon: ${path.relative(root, f)} ${statSync(f).size} bytes`);
