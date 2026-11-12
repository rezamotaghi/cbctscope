#!/usr/bin/env node
// The post-deploy check of the site (docs/web-build.md, section 9), run by the release job
// against https://cbctscope.com after the production deploy and by the rehearsal workflow
// against a preview deployment. Fail-closed: any problem exits 1.
//
//   node scripts/site-check.mjs --base <url> [--out out] [--attempts 3]
//   node scripts/site-check.mjs --base-from <file holding what `vercel deploy` printed> ...
//
// For every address in <out>/sitemap.xml, plus /sitemap.xml, /robots.txt and the agent frame:
// the answer is 200 with no redirect, the body is the file in <out>/ byte for byte (so nothing
// was injected: no analytics, no speed-insights script, no toolbar), and the response carries
// the headers of scripts/vercel-output.mjs. A missing address answers 404 with 404.html.
// A whole run is retried (--attempts, 15 s apart) only so that a domain that has just been
// pointed at the new deployment can settle; the last run decides.
//
// A preview deployment sits behind Vercel's Deployment Protection; the secret of Protection
// Bypass for Automation, when set in VERCEL_AUTOMATION_BYPASS_SECRET, goes in the
// x-vercel-protection-bypass header. No other header is sent, so a toolbar is not suppressed:
// if Vercel injects one, the byte comparison fails.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from '../components/siteAddress.mjs';
import { AGENT_FRAME_FILE } from './agent-frame.mjs';
import { sitePages } from './sitemap.mjs';
import { NOT_FOUND_FILE, headersFor } from './vercel-output.mjs';

/**
 * The deployment address `vercel deploy` printed: stdout is the address, or a JSON document in
 * the CLI's non-interactive mode; either way the last *.vercel.app address in it, or else the
 * last https address.
 * @param {string} stdout
 */
export function deploymentUrl(stdout) {
  const found = stdout.match(/https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9.-])/g);
  if (!found) throw new Error('site-check: no https address in the deploy output');
  const app = found.filter((u) => u.endsWith('.vercel.app'));
  return (app.length ? app : found).at(-1);
}

/**
 * The site paths a sitemap lists, each an address on the production site.
 * @param {string} xml
 */
export function sitemapPaths(xml) {
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!locs.length) throw new Error('site-check: the sitemap lists no address');
  return locs.map((loc) => {
    if (loc !== SITE_URL && !loc.startsWith(`${SITE_URL}/`)) throw new Error(`site-check: ${loc} is not on ${SITE_URL}`);
    return loc === SITE_URL ? '/' : loc.slice(SITE_URL.length);
  });
}

/**
 * Every address to check and the file in the export it must serve.
 * @param {string} outDir
 * @returns {{ path: string, file: string, status: number }[]}
 */
export function checkList(outDir) {
  const byUrl = new Map(sitePages(outDir).map((p) => [p.url, p.file]));
  const list = sitemapPaths(readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8')).map((p) => {
    const file = byUrl.get(p === '/' ? SITE_URL : `${SITE_URL}${p}`);
    if (!file) throw new Error(`site-check: the sitemap lists ${p}, which the export does not hold`);
    return { path: p, file, status: 200 };
  });
  list.push(
    { path: '/sitemap.xml', file: 'sitemap.xml', status: 200 },
    { path: '/robots.txt', file: 'robots.txt', status: 200 },
    { path: `/${AGENT_FRAME_FILE}`, file: AGENT_FRAME_FILE, status: 200 },
    { path: '/this-address-does-not-exist', file: NOT_FOUND_FILE, status: 404 },
  );
  return list;
}

/**
 * The header problems of a response, against the headers its address must carry.
 * @param {{ get(name: string): string | null }} headers
 * @param {Record<string, string>} expected
 */
export function headerProblems(headers, expected) {
  const problems = [];
  for (const [name, value] of Object.entries(expected)) {
    const got = headers.get(name);
    if (got !== value) problems.push(`${name} is ${got === null ? 'missing' : JSON.stringify(got)}, expected ${JSON.stringify(value)}`);
  }
  return problems;
}

/** markers of something the host adds to a page: its toolbar, its analytics or speed-insights script */
const INJECTED = ['vercel.live', '/_vercel/', 'vercel-toolbar', 'va.vercel-scripts.com'];

/**
 * Whether a served body is the built file byte for byte; null when it is, a description when not.
 * @param {Uint8Array} served
 * @param {Uint8Array} built
 */
export function bodyProblem(served, built) {
  const a = Buffer.from(served);
  const b = Buffer.from(built);
  if (a.equals(b)) return null;
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at += 1;
  const text = a.toString('latin1');
  const marks = INJECTED.filter((m) => text.includes(m) && !b.toString('latin1').includes(m));
  return `served ${a.length} bytes, built ${b.length}, first difference at byte ${at}${marks.length ? `; the served body carries ${marks.join(', ')}` : ''}`;
}

/**
 * One run over the list; returns the problems.
 * @param {string} base
 * @param {string} outDir
 * @param {Record<string, string>} requestHeaders
 */
async function runOnce(base, outDir, requestHeaders) {
  const problems = [];
  for (const item of checkList(outDir)) {
    const url = new URL(item.path, base).toString();
    let res;
    try {
      res = await fetch(url, { redirect: 'manual', headers: requestHeaders, cache: 'no-store' });
    } catch (err) {
      problems.push(`${item.path}: request failed (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    const served = new Uint8Array(await res.arrayBuffer());
    if (res.status !== item.status) {
      const where = res.headers.get('location');
      problems.push(`${item.path}: status ${res.status}${where ? ` to ${where}` : ''}, expected ${item.status}`);
      continue;
    }
    for (const p of headerProblems(res.headers, headersFor(item.path))) problems.push(`${item.path}: ${p}`);
    const body = bodyProblem(served, readFileSync(path.join(outDir, item.file)));
    if (body) problems.push(`${item.path}: not ${item.file} byte for byte: ${body}`);
  }
  return problems;
}

function argValue(args, name, fallback) {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const v = args[at + 1];
  if (!v || v.startsWith('--')) throw new Error(`site-check: ${name} needs a value`);
  return v;
}

async function main() {
  const args = process.argv.slice(2);
  const from = argValue(args, '--base-from', '');
  const base = from ? deploymentUrl(readFileSync(from, 'utf8')) : argValue(args, '--base', '');
  if (!/^https?:\/\//.test(base)) {
    console.error('usage: node scripts/site-check.mjs (--base <url> | --base-from <deploy output>) [--out out] [--attempts 3]');
    process.exit(2);
  }
  const outDir = path.resolve(argValue(args, '--out', 'out'));
  const attempts = Math.max(1, Number(argValue(args, '--attempts', '3')) || 1);
  const requestHeaders = {};
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) requestHeaders['x-vercel-protection-bypass'] = bypass;
  const count = checkList(outDir).length;
  for (let attempt = 1; ; attempt += 1) {
    const problems = await runOnce(base, outDir, requestHeaders);
    if (!problems.length) {
      console.log(`site-check: ${base} serves all ${count} addresses as built, with the site's headers`);
      return;
    }
    console.error(`site-check: run ${attempt} of ${attempts} against ${base}: ${problems.length} problems`);
    for (const p of problems) console.error(`  ${p}`);
    if (attempt >= attempts) process.exit(1);
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
