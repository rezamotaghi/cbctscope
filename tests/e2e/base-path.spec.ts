// The base path (docs/web-build.md, section 3): a build made with NEXT_PUBLIC_BASE_PATH=/cbctscope
// can be served from a sub-path, so every chunk, the assembly Web Worker and the codec WASM
// must load from under that prefix. The site itself is built for the root; this keeps the
// sub-path build working. out-base/ is that build, served under /cbctscope only
// (anything at the bare origin is a 404), so a root-relative URL anywhere fails this test.
//
// The phantom path decodes nothing (the loader reads uncompressed exports only), so no codec
// WASM is fetched while it renders. The second half therefore resolves a codec the way the
// bundle does (webpack's public path plus the asset path baked into the chunk) and compiles it
// in the page, under the page's CSP.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { guardPage, mainCanvasHasImage, waitForVolume } from './helpers';

const BASE_PATH = '/cbctscope';
const CHUNKS = path.join(process.cwd(), 'out-base', '_next', 'static', 'chunks');

/** the bundle's public path and one codec's asset path, read from out-base/ as the browser reads them */
function codecUrl(): { publicPath: string; wasm: string } {
  const files = readdirSync(CHUNKS).filter((f) => f.endsWith('.js'));
  const runtime = files.find((f) => f.startsWith('webpack-'));
  if (!runtime) throw new Error('out-base/ has no webpack runtime chunk');
  const publicPath = /"(\/[^"]*\/_next\/)"/.exec(readFileSync(path.join(CHUNKS, runtime), 'utf8'))?.[1];
  if (!publicPath) throw new Error('no public path in the webpack runtime');
  for (const f of files) {
    const m = /"(static\/media\/[\w.-]+\.wasm)"/.exec(readFileSync(path.join(CHUNKS, f), 'utf8'));
    if (m) return { publicPath, wasm: m[1] };
  }
  throw new Error('no codec WASM is referenced by any chunk');
}

test('the phantom renders under the /cbctscope base path', async ({ page, baseURL }) => {
  const origin = new URL(baseURL as string).origin;
  const problems = guardPage(page, origin);
  const outside: string[] = [];
  const failed: string[] = [];
  page.on('request', (req) => {
    if (/^(blob|data):/.test(req.url())) return; // in-tab objects (cornerstone codec workers)
    const u = new URL(req.url());
    if (u.origin === origin && !u.pathname.startsWith(`${BASE_PATH}/`) && u.pathname !== BASE_PATH) outside.push(u.pathname);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`);
  });
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));

  await page.goto(`${BASE_PATH}/`);
  await expect(page.getByText('Research use only. Not a medical device.')).toBeVisible();
  await waitForVolume(page);
  await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(1500);

  // the phantom is generated in the assembly worker: it started, from under the prefix
  expect(workers.some((u) => new URL(u).pathname.startsWith(`${BASE_PATH}/_next/`))).toBe(true);

  // a codec WASM: addressed under the prefix, served as application/wasm, compiled under the CSP
  const { publicPath, wasm } = codecUrl();
  expect(publicPath).toBe(`${BASE_PATH}/_next/`);
  const compiled = await page.evaluate(async (url) => {
    const mod = await WebAssembly.compileStreaming(fetch(url));
    return WebAssembly.Module.exports(mod).length;
  }, publicPath + wasm);
  expect(compiled).toBeGreaterThan(0);

  expect(outside).toEqual([]);
  expect(failed).toEqual([]);
  expect(problems).toEqual([]);
});

test('under the base path the site pages load and every canonical names the production address', async ({ request }) => {
  for (const [served, canonical] of [
    [`${BASE_PATH}/`, 'https://cbctscope.com'],
    [`${BASE_PATH}/about`, 'https://cbctscope.com/about'],
    [`${BASE_PATH}/legal`, 'https://cbctscope.com/legal'],
    [`${BASE_PATH}/online-cbct-viewer`, 'https://cbctscope.com/online-cbct-viewer'],
    [`${BASE_PATH}/manual/mpr.html`, 'https://cbctscope.com/manual/mpr.html'],
  ]) {
    const res = await request.get(served);
    expect(res.status(), served).toBe(200);
    const links = [...(await res.text()).matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
    expect(links, served).toEqual([canonical]);
  }
  const sitemap = await (await request.get(`${BASE_PATH}/sitemap.xml`)).text();
  expect(sitemap).toContain('<loc>https://cbctscope.com/about</loc>');
  expect(sitemap).not.toContain(`cbctscope.com${BASE_PATH}`);
});

test('the manual loads under the /cbctscope base path', async ({ page, baseURL }) => {
  const origin = new URL(baseURL as string).origin;
  const problems = guardPage(page, origin);
  const failed: string[] = [];
  const outside: string[] = [];
  page.on('response', (res) => {
    if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`);
  });
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (u.origin === origin && !u.pathname.startsWith(`${BASE_PATH}/`)) outside.push(u.pathname);
  });
  await page.goto(`${BASE_PATH}/manual/`);
  await expect(page.getByRole('heading', { level: 1, name: 'CBCTScope User Manual' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Table of contents' }).getByRole('link', { name: '8.1 · MPR' }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE_PATH}/manual/mpr\\.html$`));
  const still = page.locator('article img').first();
  await expect.poll(() => still.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('searchbox', { name: 'Search' }).fill('window');
  await expect(page.locator('#results li').first()).toBeVisible();
  expect(outside).toEqual([]);
  expect(failed).toEqual([]);
  expect(problems).toEqual([]);
});
