#!/usr/bin/env node
// The site's layout on Vercel (docs/web-build.md, section 9): turns the web build's export into
// a deployment in the Build Output API v3 layout. `npm run build:vercel`, the build command in
// vercel.json, runs the web build and then this script, so Vercel's build of each commit
// leaves .vercel/output at the project root and serves it as it is. The response headers below
// are defined here and nowhere else.
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
//   it gets 'self' and SAMEORIGIN instead. When VERCEL_GIT_COMMIT_SHA holds a commit (Vercel
//   sets it in every build from Git), every address also answers with X-CBCTScope-Commit: that
//   commit, the one public trace of which deployment is live; the check after a deploy
//   (scripts/site-check.mjs --live) waits for it. The pages themselves never carry it: a
//   preview and the production deployment are two builds, and no Vercel variable changes a page
//   in either (scripts/site-env.mjs).
// - overrides: Next's top-level pages (about.html, legal.html, update.html) answer at /about,
//   /legal and /update, their canonical addresses, without a redirect. The manual's pages keep their .html
//   addresses, as the sitemap lists them, so a blanket cleanUrls (which would redirect them)
//   is not used.
// - an error route: a miss answers 404 with the export's 404.html.
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

/** the response header that names the commit a deployment was built from */
export const COMMIT_HEADER = 'X-CBCTScope-Commit';

/**
 * The commit to name in COMMIT_HEADER: a full git SHA, or null for anything else.
 * @param {string | undefined} value
 */
export function commitFrom(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value : null;
}

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
 * @param {string | null} [commit] the commit to name in COMMIT_HEADER (commitFrom), or none
 */
export function vercelConfig(pages, commit = null) {
  const frame = escapeRe(AGENT_FRAME_FILE);
  // in each of the two disjoint header routes, so no address depends on headers merging across routes
  const stamp = commit ? { [COMMIT_HEADER]: commit } : {};
  /** @type {Record<string, { path: string, contentType: string }>} */
  const overrides = {};
  for (const { file } of pages) {
    if (file.includes('/') || file === 'index.html') continue;
    overrides[file] = { path: sitePath(file).slice(1), contentType: 'text/html; charset=utf-8' };
  }
  return {
    version: 3,
    routes: [
      { src: `^/(?!${frame}$).*$`, headers: { ...SITE_HEADERS, ...stamp }, continue: true },
      { src: `^/${frame}$`, headers: { ...FRAME_HEADERS, ...stamp }, continue: true },
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
 * @param {string | null} [commit] the commit to name in COMMIT_HEADER, or none
 */
export function writeVercelOutput(outDir, dest, commit = null) {
  for (const f of ['index.html', NOT_FOUND_FILE, AGENT_FRAME_FILE, 'sitemap.xml']) {
    if (!existsSync(path.join(outDir, f))) throw new Error(`vercel-output: ${outDir}/${f} is missing; run npm run build:web first`);
  }
  const output = path.join(dest, '.vercel', 'output');
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  cpSync(outDir, path.join(output, 'static'), { recursive: true });
  writeFileSync(path.join(output, 'config.json'), `${JSON.stringify(vercelConfig(sitePages(outDir), commit), null, 2)}\n`);
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [outDir = 'out', dest = '.'] = process.argv.slice(2);
  const commit = commitFrom(process.env.VERCEL_GIT_COMMIT_SHA);
  const output = writeVercelOutput(path.resolve(outDir), path.resolve(dest), commit);
  console.log(`vercel-output: ${output} written from ${outDir}/, ${commit ? `${COMMIT_HEADER}: ${commit}` : `no ${COMMIT_HEADER} (VERCEL_GIT_COMMIT_SHA holds no commit)`}`);
}
