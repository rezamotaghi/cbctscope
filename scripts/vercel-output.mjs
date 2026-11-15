#!/usr/bin/env node
// The site's deployment on Vercel (docs/web-build.md, section 9): turns the web build's export
// into a prebuilt deployment in the Build Output API v3 layout, which `vercel deploy --prebuilt`
// uploads as it is. Nothing is built on Vercel and no project setting shapes the files.
//
//   node scripts/vercel-output.mjs [out=out] [dest=.]
//
// writes <dest>/.vercel/output/static/ (a byte copy of the export) and
// <dest>/.vercel/output/config.json:
//
// - routes: three response headers on every address, added on top of the page's own CSP meta
//   tag (which stays exactly as build-web wrote it):
//     Content-Security-Policy: frame-ancestors 'none'   (a meta tag cannot carry frame-ancestors)
//     X-Frame-Options: DENY                              (the same, for browsers without CSP 2)
//     X-Content-Type-Options: nosniff                    (files are used only as their type says)
//   The agent frame is the one page the site frames itself (the panel's sandboxed iframe), so
//   it gets 'self' and SAMEORIGIN instead.
// - overrides: Next's top-level pages (about.html, legal.html, update.html) answer at /about,
//   /legal and /update, their canonical addresses, without a redirect. The manual's pages keep their .html
//   addresses, as the sitemap lists them, so a blanket cleanUrls (which would redirect them)
//   is not used.
// - an error route: a miss answers 404 with the export's 404.html.
//
// scripts/site-check.mjs proves the deployment serves these files byte for byte with these
// headers.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_FRAME_FILE } from './agent-frame.mjs';
import { sitePages, sitePath } from './sitemap.mjs';

/** the response headers of every address but the agent frame */
export const SITE_HEADERS = Object.freeze({
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
});

/** the agent frame's: the viewer frames it from the same origin */
export const FRAME_HEADERS = Object.freeze({
  'Content-Security-Policy': "frame-ancestors 'self'",
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
});

/** the export's not-found page, served with status 404 on a miss */
export const NOT_FOUND_FILE = '404.html';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The headers an address answers with.
 * @param {string} pathname
 */
export function headersFor(pathname) {
  return pathname === `/${AGENT_FRAME_FILE}` ? FRAME_HEADERS : SITE_HEADERS;
}

/**
 * The Build Output API v3 config for an export's pages.
 * @param {{ file: string }[]} pages the site's pages (scripts/sitemap.mjs sitePages)
 */
export function vercelConfig(pages) {
  const frame = escapeRe(AGENT_FRAME_FILE);
  /** @type {Record<string, { path: string, contentType: string }>} */
  const overrides = {};
  for (const { file } of pages) {
    if (file.includes('/') || file === 'index.html') continue;
    overrides[file] = { path: sitePath(file).slice(1), contentType: 'text/html; charset=utf-8' };
  }
  return {
    version: 3,
    routes: [
      { src: `^/(?!${frame}$).*$`, headers: { ...SITE_HEADERS }, continue: true },
      { src: `^/${frame}$`, headers: { ...FRAME_HEADERS }, continue: true },
      { handle: 'filesystem' },
      { handle: 'error' },
      { src: '^/.*$', dest: `/${NOT_FOUND_FILE}`, status: 404 },
    ],
    overrides,
  };
}

/**
 * Write <dest>/.vercel/output from the export in outDir; returns the output directory.
 * @param {string} outDir
 * @param {string} dest
 */
export function writeVercelOutput(outDir, dest) {
  for (const f of ['index.html', NOT_FOUND_FILE, AGENT_FRAME_FILE, 'sitemap.xml']) {
    if (!existsSync(path.join(outDir, f))) throw new Error(`vercel-output: ${outDir}/${f} is missing; run npm run build:web first`);
  }
  const output = path.join(dest, '.vercel', 'output');
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  cpSync(outDir, path.join(output, 'static'), { recursive: true });
  writeFileSync(path.join(output, 'config.json'), `${JSON.stringify(vercelConfig(sitePages(outDir)), null, 2)}\n`);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [outDir = 'out', dest = '.'] = process.argv.slice(2);
  const output = writeVercelOutput(path.resolve(outDir), path.resolve(dest));
  console.log(`vercel-output: ${output} written from ${outDir}/`);
}
