#!/usr/bin/env node
// The post-deploy check of the site (docs/web-build.md, section 9). The release job runs it
// against the production deployment it just made, the rehearsal workflow against a preview,
// and the owner against https://cbctscope.com once the address records point at Vercel.
// Fail-closed: any problem exits 1.
//
//   node scripts/site-check.mjs --base <url> [--out out] [--attempts 3]
//   node scripts/site-check.mjs --base-from <file holding the stdout of `vercel deploy`> ...
//   ... --rehearsal [--forbid-host <host>]   refuse the public domain (and <host>) as the base
//
// Every file in <out>/ is requested at the address it is served from (Next's top-level pages
// at their extensionless addresses, scripts/vercel-output.mjs), and so is every address in the
// sitemap: the answer is 200 with no redirect, the body is the file byte for byte (so nothing
// was injected: no analytics, no speed-insights script, no toolbar), the Content-Type is the
// one its extension needs (with nosniff on, a wrong type on a worker or the WASM would break
// the viewer), and the response carries the headers of scripts/vercel-output.mjs. A missing
// address answers 404 with 404.html. Each request gives up after 20 s. A whole run is retried
// (--attempts, 15 s apart) only so that a domain that has just been pointed at the deployment
// can settle; the last run decides.
//
// Deployment Protection covers previews and the generated address of every deployment; the
// secret of Protection Bypass for Automation, when set in VERCEL_AUTOMATION_BYPASS_SECRET,
// goes in the x-vercel-protection-bypass header. No other header is sent, so a toolbar is not
// suppressed: if Vercel injects one, the byte comparison fails.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from '../components/siteAddress.mjs';
import { sitePages } from './sitemap.mjs';
import { NOT_FOUND_FILE, headersFor, vercelConfig } from './vercel-output.mjs';

/** the media types each extension in the export may be served with */
export const CONTENT_TYPES = Object.freeze({
  '.html': ['text/html'],
  '.js': ['application/javascript', 'text/javascript'],
  '.css': ['text/css'],
  '.wasm': ['application/wasm'],
  '.json': ['application/json'],
  '.xml': ['application/xml', 'text/xml'],
  '.txt': ['text/plain'],
  '.webp': ['image/webp'],
  '.png': ['image/png'],
  '.svg': ['image/svg+xml'],
  '.ico': ['image/x-icon', 'image/vnd.microsoft.icon'],
});

/** the hosts of the public site: a rehearsal must never check them */
export const PUBLIC_HOSTS = Object.freeze([new URL(SITE_URL).host, `www.${new URL(SITE_URL).host}`]);

const REQUEST_TIMEOUT_MS = 20_000;
const CONCURRENCY = 8;

/**
 * The deployment address from the stdout of `vercel deploy` (stderr carries its progress):
 * exactly one https address and nothing else, or an error that quotes what was captured.
 * @param {string} stdout
 */
export function deploymentUrl(stdout) {
  const text = stdout.trim();
  if (!/^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}\/?$/.test(text)) {
    throw new Error(`site-check: the deploy output is not exactly one https address: ${JSON.stringify(stdout.slice(0, 500))}`);
  }
  return text.replace(/\/$/, '');
}

/**
 * Refuse a production address as the base of a rehearsal.
 * @param {string} base
 * @param {string[]} forbidden extra hosts, such as the project's production address
 */
export function refuseProduction(base, forbidden = []) {
  const host = new URL(base).host;
  if ([...PUBLIC_HOSTS, ...forbidden].includes(host)) throw new Error(`site-check: a rehearsal must not check ${host}, a production address`);
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

/** every file of the export, relative, with forward slashes */
export function exportFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...exportFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/**
 * The problem with a response's Content-Type for a file, or null; an extension with no
 * expectation is itself a problem, so a new kind of file cannot go unchecked.
 * @param {string} file
 * @param {string | null} header
 */
export function contentTypeProblem(file, header) {
  const ext = path.extname(file).toLowerCase();
  const allowed = CONTENT_TYPES[ext];
  if (!allowed) return `no Content-Type is expected for ${ext || 'a file without an extension'} (add it to CONTENT_TYPES)`;
  const got = (header ?? '').split(';')[0].trim().toLowerCase();
  return allowed.includes(got) ? null : `Content-Type is ${header === null ? 'missing' : JSON.stringify(header)}, expected ${allowed.join(' or ')}`;
}

/**
 * Every address to check and the file in the export it must serve.
 * @param {string} outDir
 * @returns {{ path: string, file: string, status: number }[]}
 */
export function checkList(outDir) {
  const pages = sitePages(outDir);
  const byUrl = new Map(pages.map((p) => [p.url, p.file]));
  const moved = vercelConfig(pages).overrides;
  /** @type {Map<string, { path: string, file: string, status: number }>} */
  const list = new Map();
  for (const p of sitemapPaths(readFileSync(path.join(outDir, 'sitemap.xml'), 'utf8'))) {
    const file = byUrl.get(p === '/' ? SITE_URL : `${SITE_URL}${p}`);
    if (!file) throw new Error(`site-check: the sitemap lists ${p}, which the export does not hold`);
    list.set(p, { path: p, file, status: 200 });
  }
  for (const file of exportFiles(outDir)) {
    const at = moved[file] ? `/${moved[file].path}` : `/${file}`;
    if (!list.has(at)) list.set(at, { path: at, file, status: 200 });
  }
  list.set('/this-address-does-not-exist', { path: '/this-address-does-not-exist', file: NOT_FOUND_FILE, status: 404 });
  return [...list.values()];
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

/** the one message for answers that a protection wall gave instead of the site */
export function protectionMessage(count) {
  return `${count} addresses answered 401 or 403: the deployment is behind Vercel's Deployment Protection, and VERCEL_AUTOMATION_BYPASS_SECRET is missing or wrong`;
}

/**
 * Check one address; returns its problems, or 'protected' for a 401 or 403.
 * @param {string} base
 * @param {string} outDir
 * @param {{ path: string, file: string, status: number }} item
 * @param {Record<string, string>} requestHeaders
 */
async function checkOne(base, outDir, item, requestHeaders) {
  const url = new URL(item.path.split('/').map(encodeURIComponent).join('/'), base).toString();
  let res;
  let served;
  try {
    res = await fetch(url, { redirect: 'manual', headers: requestHeaders, cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    served = new Uint8Array(await res.arrayBuffer());
  } catch (err) {
    const why = err instanceof Error && err.name === 'TimeoutError' ? `no answer within ${REQUEST_TIMEOUT_MS / 1000} s` : err instanceof Error ? err.message : String(err);
    return [`${url}: request failed (${why})`];
  }
  if (res.status === 401 || res.status === 403) return 'protected';
  if (res.status !== item.status) {
    const where = res.headers.get('location');
    return [`${item.path}: status ${res.status}${where ? ` to ${where}` : ''}, expected ${item.status}`];
  }
  const problems = headerProblems(res.headers, headersFor(item.path)).map((p) => `${item.path}: ${p}`);
  const type = contentTypeProblem(item.file, res.headers.get('content-type'));
  if (type) problems.push(`${item.path}: ${type}`);
  const body = bodyProblem(served, readFileSync(path.join(outDir, item.file)));
  if (body) problems.push(`${item.path}: not ${item.file} byte for byte: ${body}`);
  return problems;
}

/**
 * One run over the list, a few requests at a time.
 * @returns {Promise<{ problems: string[], walled: number }>}
 */
async function runOnce(base, outDir, list, requestHeaders) {
  const problems = [];
  let walled = 0;
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const item = list[next++];
      const r = await checkOne(base, outDir, item, requestHeaders);
      if (r === 'protected') walled += 1;
      else problems.push(...r);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { problems, walled };
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
  const base = from ? deploymentUrl(readFileSync(from, 'utf8')) : argValue(args, '--base', '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) {
    console.error('usage: node scripts/site-check.mjs (--base <url> | --base-from <deploy stdout>) [--out out] [--attempts 3] [--rehearsal [--forbid-host <host>]]');
    process.exit(2);
  }
  if (args.includes('--rehearsal')) {
    const forbidden = args.flatMap((a, i) => (a === '--forbid-host' && args[i + 1] ? [args[i + 1]] : []));
    refuseProduction(base, forbidden);
  }
  const outDir = path.resolve(argValue(args, '--out', 'out'));
  const attempts = Math.max(1, Number(argValue(args, '--attempts', '3')) || 1);
  const requestHeaders = {};
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) requestHeaders['x-vercel-protection-bypass'] = bypass;
  const list = checkList(outDir);
  for (let attempt = 1; ; attempt += 1) {
    const { problems, walled } = await runOnce(base, outDir, list, requestHeaders);
    if (walled) {
      console.error(`site-check: ${base}: ${protectionMessage(walled)}`);
      process.exit(1);
    }
    if (!problems.length) {
      console.log(`site-check: ${base} serves all ${list.length} addresses as built, with the site's headers and types`);
      return;
    }
    console.error(`site-check: run ${attempt} of ${attempts} against ${base}: ${problems.length} problems`);
    for (const p of problems.sort()) console.error(`  ${p}`);
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
