#!/usr/bin/env node
// npm run build:web: the static web build (docs/web-build.md, section 3), cross-platform.
//
//   node scripts/build-web.mjs [--out <dir>]
//
// 0. Renders the user manual into public/manual/ (scripts/manual-html.mjs), so the export
//    carries it as manual/ and step 3 gives its pages the CSP like every other page.
// 1. Sets CBCTSCOPE_TARGET=web and NEXT_PUBLIC_CBCTSCOPE_TARGET=web and runs `next build`;
//    next.config.mjs turns that into a static export in out/ (or <dir> with --out, used by the
//    end-to-end suite's low-threshold build so out/ stays intact).
// 2. Checks that middleware.ts stayed out of the target (pageExtensions excludes .ts files;
//    verified on Next 15.5, so no sidelining of app/api or middleware.ts is needed).
// 3. Writes the CSP meta tag (components/webCsp.mjs) into every exported HTML page, right
//    after the charset so it precedes every script, with one 'sha256-...' source per inline
//    script of that page. No 'unsafe-inline' for scripts. A JSON-LD data block
//    (type="application/ld+json", the structured data of the home and About pages) is never
//    executed, so it gets no hash: the policy allows exactly the scripts that run.
// 4. Writes agent-frame.html (scripts/agent-frame.mjs), the sandboxed page the in-page agent's
//    provider calls run in, with its own policy.
// 5. Writes sitemap.xml and robots.txt (scripts/sitemap.mjs) from the pages the export holds,
//    every address the production one whatever the base path.
import { spawn } from 'node:child_process';
import { webCsp } from '../components/webCsp.mjs';
import { writeManual } from './manual-html.mjs';
import { AGENT_FRAME_FILE, writeAgentFrame } from './agent-frame.mjs';
import { writeSitemap } from './sitemap.mjs';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = outFlag >= 0 ? args[outFlag + 1] : 'out';
if (!outDir || outDir.startsWith('-')) {
  console.error('usage: node scripts/build-web.mjs [--out <dir>]');
  process.exit(2);
}

const env = { ...process.env, CBCTSCOPE_TARGET: 'web', NEXT_PUBLIC_CBCTSCOPE_TARGET: 'web' };
if (outDir !== 'out') env.CBCTSCOPE_OUT_DIR = outDir;
else delete env.CBCTSCOPE_OUT_DIR;

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

function run() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [nextBin, 'build'], { cwd: root, env, stdio: 'inherit' });
    const forward = (sig) => child.kill(sig);
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);
    child.on('exit', (code, signal) => {
      process.off('SIGINT', forward);
      process.off('SIGTERM', forward);
      resolve(signal ? 1 : (code ?? 1));
    });
  });
}

function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...htmlFiles(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

const encode = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
/** a data block the browser never executes (JSON-LD): no hash, so script-src stays exact */
const DATA_BLOCK_RE = /\btype="application\/ld\+json"/i;
const CHARSET_RE = /<meta charSet="utf-8"\s*\/?>/i;

/** write the CSP meta tag, with this page's inline-script hashes, first in <head> */
function addCsp(html) {
  if (/http-equiv="Content-Security-Policy"/i.test(html)) throw new Error('the page already carries a CSP meta tag');
  const hashes = new Set();
  for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
    if (!m[2] || DATA_BLOCK_RE.test(m[1])) continue;
    hashes.add(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
  }
  const tag = `<meta http-equiv="Content-Security-Policy" content="${encode(webCsp([...hashes]))}"/>`;
  const charset = CHARSET_RE.exec(html);
  if (!charset) throw new Error('the exported page has no charset meta tag to anchor the CSP');
  return { html: html.replace(charset[0], `${charset[0]}${tag}`), count: hashes.size };
}

writeManual();
const code = await run();
if (code !== 0) process.exit(code);

// the dist directory this build used: next.config.mjs maps --out <dir> to distDir, else .next
const distDir = outDir === 'out' ? '.next' : outDir;
const manifest = path.join(root, distDir, 'server', 'middleware-manifest.json');
if (existsSync(manifest)) {
  const m = JSON.parse(readFileSync(manifest, 'utf8'));
  if (Object.keys(m.middleware ?? {}).length) {
    console.error('build:web: middleware.ts entered the web target; pageExtensions no longer excludes it');
    process.exit(1);
  }
}

const outPath = path.join(root, outDir);
let pages = 0;
let total = 0;
for (const file of htmlFiles(outPath)) {
  if (path.relative(outPath, file) === AGENT_FRAME_FILE) continue; // written below, with its own policy
  const { html, count } = addCsp(readFileSync(file, 'utf8'));
  writeFileSync(file, html);
  pages += 1;
  total += count;
}
const frameBytes = await writeAgentFrame(outPath);
console.log(`build:web: ${outDir}/${AGENT_FRAME_FILE} written (${frameBytes} bytes)`);
const listed = writeSitemap(outPath);
console.log(`build:web: ${outDir}/sitemap.xml lists ${listed} pages; robots.txt written`);
console.log(`build:web: ${outDir}/ ready, CSP hashes for ${total} inline scripts across ${pages} pages`);
