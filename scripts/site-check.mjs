#!/usr/bin/env node
// The checks of the served site (docs/web-build.md, section 9), in two modes. Fail-closed: any
// problem exits 1.
//
// The live mode checks the public site, https://cbctscope.com, or with --base a deployment's own
// address such as a preview. It is the alarm after a deploy: the workflow site-check.yml runs it
// when Vercel reports a successful production deployment, with the deployment's commit.
//
//   node scripts/site-check.mjs --live [--base <url>] [--commit <sha>] [--attempts 3]
//
// Against any address but the public site, the secret of Protection Bypass for Automation, when
// set in VERCEL_AUTOMATION_BYPASS_SECRET, goes in the x-vercel-protection-bypass header; it is
// read from the environment only and never printed. The sitemap names production addresses,
// which are then read as paths on that address.
//
// It cannot compare bytes with a local build: Vercel builds each commit itself, and no two
// builds of the web target are byte-identical (Next names each build with a fresh id), so the
// live mode checks what a visitor gets instead:
// - with --commit, first that the site answers with that commit in X-CBCTScope-Commit
//   (scripts/vercel-output.mjs), asking every 15 s up to 20 times, so it never checks the
//   deployment before; then that every address it reads carries that commit;
// - every address in the live sitemap.xml and the fixed files of the layout (LIVE_FILES) answer
//   200 with no redirect, the Content-Type their extension needs and the headers of
//   scripts/vercel-output.mjs, and a missing address answers 404 with the body of /404.html;
// - every script and stylesheet a page references is on the site's own origin and answers 200
//   with its type and headers;
// - no page, as an anonymous visitor gets it, carries a marker of Vercel's analytics, speed
//   insights or toolbar (FORBIDDEN_MARKERS);
// - the update page names the version in package.json of this checkout, the deployed commit's.
//
// The byte mode checks a server against an export on disk, for an export built here and served
// with the layout's headers (for instance a prebuilt deployment made by hand from it):
//
//   node scripts/site-check.mjs --base <url> [--out out] [--attempts 3]
//
// Every file in <out>/ is requested at the address it is served from (Next's top-level pages
// at their extensionless addresses, scripts/vercel-output.mjs), and so is every address in the
// sitemap: the answer is 200 with no redirect, the body is the file byte for byte, the
// Content-Type is the one its extension needs, and the response carries the layout's headers.
// A missing address answers 404 with 404.html. Deployment Protection covers every deployment's
// own address; the secret of Protection Bypass for Automation, when set in
// VERCEL_AUTOMATION_BYPASS_SECRET, goes in the x-vercel-protection-bypass header.
//
// In both modes each request gives up after 20 s, and a whole run is retried (--attempts, 15 s
// apart); the last run decides. With nosniff on, a wrong type on a worker or the WASM would
// break the viewer, so the type is checked everywhere.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from '../components/siteAddress.mjs';
import { sitePages, sitePath } from './sitemap.mjs';
import { COMMIT_HEADER, NOT_FOUND_FILE, headersFor, vercelConfig } from './vercel-output.mjs';

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

/**
 * What a page must never carry: the strings Vercel's documentation gives for what its products
 * put in a page. Web Analytics: the routes under /_vercel/insights/, the `window.vaq` queue of its
 * HTML snippet and the @vercel/analytics package (vercel.com/docs/analytics/quickstart). Speed
 * Insights: /_vercel/speed-insights/, `window.siq` and @vercel/speed-insights
 * (vercel.com/docs/speed-insights/quickstart). The toolbar: its host, https://vercel.live, which
 * its CSP advice adds to script-src (vercel.com/docs/vercel-toolbar/managing-toolbar). Both
 * products' scripts may also load from a project's own unique path, which no list can name; the
 * queues of their snippets cover that form.
 */
export const FORBIDDEN_MARKERS = Object.freeze([
  '/_vercel/insights/',
  '/_vercel/speed-insights/',
  'window.vaq',
  'window.siq',
  '@vercel/analytics',
  '@vercel/speed-insights',
  'https://vercel.live',
]);

/** the files the live mode checks besides the sitemap's addresses: crawlers, icons, the share image, the update page, the agent frame, the manual */
export const LIVE_FILES = Object.freeze([
  '/robots.txt',
  '/sitemap.xml',
  '/icon.svg',
  '/apple-icon.png',
  '/og-card.png',
  sitePath('update.html'),
  '/agent-frame.html',
  sitePath('manual/index.html'),
]);

/** an address no page has: it must answer 404 with the site's own page */
export const MISSING_PATH = '/this-address-does-not-exist';

const REQUEST_TIMEOUT_MS = 20_000;
const CONCURRENCY = 8;
const RETRY_MS = 15_000;
const COMMIT_POLLS = 20;

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
 * Every file of the export, relative, with forward slashes.
 * @param {string} dir
 * @param {string} [base]
 * @returns {string[]}
 */
export function exportFiles(dir, base = dir) {
  /** @type {string[]} */
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
 * The file name whose extension sets the type an address must be served with: a folder or an
 * extensionless page is HTML.
 * @param {string} pathname
 */
export function typeFileFor(pathname) {
  if (pathname.endsWith('/')) return `${pathname}index.html`;
  return path.posix.extname(pathname) ? pathname : `${pathname}.html`;
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
  list.set(MISSING_PATH, { path: MISSING_PATH, file: NOT_FOUND_FILE, status: 404 });
  return [...list.values()];
}

/**
 * The live mode's addresses: the sitemap's, then the fixed files not already among them.
 * @param {string} sitemapXml the live sitemap.xml
 */
export function liveList(sitemapXml) {
  return [...new Set([...sitemapPaths(sitemapXml), ...LIVE_FILES])];
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

/**
 * The forbidden markers a page carries, in list order.
 * @param {string} html
 */
export function forbiddenMarkers(html) {
  return FORBIDDEN_MARKERS.filter((m) => html.includes(m));
}

/**
 * The scripts and stylesheets a page references, as absolute addresses: every <script src>,
 * every <link rel="stylesheet">, and every <link rel="preload" or "modulepreload"> of a script
 * or style.
 * @param {string} html
 * @param {string} pageUrl the page's own address, against which relative references resolve
 */
export function pageAssets(html, pageUrl) {
  const refs = new Set();
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) refs.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (/\brel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '').toLowerCase().split(/\s+/);
    const as = (/\bas\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '').toLowerCase();
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    if (rel.includes('stylesheet') || rel.includes('modulepreload') || (rel.includes('preload') && (as === 'script' || as === 'style'))) refs.add(href);
  }
  return [...refs].map((ref) => new URL(ref.replace(/&amp;/g, '&'), pageUrl).toString());
}

/**
 * The assets that are not on the site's own origin, one line each.
 * @param {string[]} assets absolute addresses (pageAssets)
 * @param {string} base the site's address
 */
export function offOriginAssets(assets, base) {
  const origin = new URL(base).origin;
  return assets.filter((a) => new URL(a).origin !== origin).map((a) => `references ${a}, which is not on ${origin}`);
}

/** the sentence the update page carries in its exported HTML (components/UpdateStatus.tsx, the state with no version) */
export const newestSentence = (/** @type {string} */ version) => `The newest version of CBCTScope is ${version}.`;

/**
 * Why the update page does not name the version, or null when it does.
 * @param {string} html the served update page
 * @param {string} version the version in package.json
 */
export function versionProblem(html, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return `package.json's version "${version}" is not major.minor.patch`;
  return html.includes(newestSentence(version)) ? null : `the update page does not say "${newestSentence(version)}"`;
}

/**
 * Why a response is not from the deployment of the commit, or null when it is.
 * @param {string | null} header the response's X-CBCTScope-Commit
 * @param {string} commit
 */
export function commitProblem(header, commit) {
  if (header === commit) return null;
  return header === null ? `${COMMIT_HEADER} is missing, expected ${commit}` : `${COMMIT_HEADER} is ${header}, expected ${commit}`;
}

/** the one message for answers that a protection wall gave instead of the site */
export function protectionMessage(count) {
  return `${count} addresses answered 401 or 403: the deployment is behind Vercel's Deployment Protection, and VERCEL_AUTOMATION_BYPASS_SECRET is missing or wrong`;
}

/**
 * One request; the response and its body, or the line saying why there is none.
 * @param {string} url
 * @param {Record<string, string>} headers
 * @returns {Promise<{ res: Response, body: Uint8Array } | { error: string }>}
 */
async function get(url, headers = {}) {
  try {
    const res = await fetch(url, { redirect: 'manual', headers, cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return { res, body: new Uint8Array(await res.arrayBuffer()) };
  } catch (err) {
    const why = err instanceof Error && err.name === 'TimeoutError' ? `no answer within ${REQUEST_TIMEOUT_MS / 1000} s` : err instanceof Error ? err.message : String(err);
    return { error: `${url}: request failed (${why})` };
  }
}

/** a status other than the expected one, with the redirect target or the host's own error code */
function statusLine(where, res, expected) {
  const to = res.headers.get('location');
  const hostError = res.headers.get('x-vercel-error');
  const wall = res.status === 401 || res.status === 403 ? '; behind Deployment Protection, so VERCEL_AUTOMATION_BYPASS_SECRET is missing or wrong' : '';
  return `${where}: status ${res.status}${to ? ` to ${to}` : ''}${hostError ? ` (${hostError})` : ''}, expected ${expected}${wall}`;
}

/** the address of a site path on a base */
const urlOf = (base, p) => new URL(p.split('/').map(encodeURIComponent).join('/'), base).toString();

/** run fn over items, a few at a time, collecting the lines it returns */
async function pool(items, fn) {
  const out = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) out.push(...(await fn(items[next++])));
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

/**
 * Check one byte-mode address; returns its problems, or 'protected' for a 401 or 403.
 * @param {string} base
 * @param {string} outDir
 * @param {{ path: string, file: string, status: number }} item
 * @param {Record<string, string>} requestHeaders
 */
async function checkOne(base, outDir, item, requestHeaders) {
  const r = await get(urlOf(base, item.path), requestHeaders);
  if ('error' in r) return [r.error];
  const { res, body } = r;
  if (res.status === 401 || res.status === 403) return 'protected';
  if (res.status !== item.status) return [statusLine(item.path, res, item.status)];
  const problems = headerProblems(res.headers, headersFor(item.path)).map((p) => `${item.path}: ${p}`);
  const type = contentTypeProblem(item.file, res.headers.get('content-type'));
  if (type) problems.push(`${item.path}: ${type}`);
  const built = readFileSync(path.join(outDir, item.file));
  if (!Buffer.from(body).equals(built)) {
    let at = 0;
    while (at < body.length && at < built.length && body[at] === built[at]) at += 1;
    problems.push(`${item.path}: not ${item.file} byte for byte: served ${body.length} bytes, built ${built.length}, first difference at byte ${at}`);
  }
  return problems;
}

/** one byte-mode run over the list */
async function byteRun(base, outDir, list, requestHeaders) {
  let walled = 0;
  const problems = await pool(list, async (item) => {
    const r = await checkOne(base, outDir, item, requestHeaders);
    if (r === 'protected') {
      walled += 1;
      return [];
    }
    return r;
  });
  return { problems, walled };
}

/**
 * Check one live address: status, type, headers, the commit; returns its problems and, for a
 * page, its text.
 * @param {string} base
 * @param {string} p
 * @param {number} status
 * @param {string | null} commit
 */
async function liveOne(base, p, status, commit, headers) {
  const r = await get(urlOf(base, p), headers);
  if ('error' in r) return { problems: [r.error], text: null };
  const { res, body } = r;
  if (res.status !== status) return { problems: [statusLine(p, res, status)], text: null };
  const problems = headerProblems(res.headers, headersFor(p)).map((x) => `${p}: ${x}`);
  const type = contentTypeProblem(status === 404 ? NOT_FOUND_FILE : typeFileFor(p), res.headers.get('content-type'));
  if (type) problems.push(`${p}: ${type}`);
  if (commit) {
    const c = commitProblem(res.headers.get(COMMIT_HEADER), commit);
    if (c) problems.push(`${p}: ${c}`);
  }
  const html = path.posix.extname(typeFileFor(p)) === '.html' || status === 404;
  return { problems, text: html ? Buffer.from(body).toString('utf8') : null };
}

/** one live run */
async function liveRun(base, commit, version, headers) {
  const sitemap = await get(urlOf(base, '/sitemap.xml'), headers);
  if ('error' in sitemap) return { problems: [sitemap.error], count: 0 };
  if (sitemap.res.status !== 200) return { problems: [statusLine('/sitemap.xml', sitemap.res, 200)], count: 0 };
  const list = liveList(Buffer.from(sitemap.body).toString('utf8'));
  /** @type {Map<string, string>} */
  const pages = new Map();
  const problems = await pool([...list.map((p) => ({ p, status: 200 })), { p: MISSING_PATH, status: 404 }, { p: `/${NOT_FOUND_FILE}`, status: 200 }], async ({ p, status }) => {
    const r = await liveOne(base, p, status, commit, headers);
    if (r.text !== null) pages.set(p, r.text);
    return r.problems;
  });
  const notFound = pages.get(MISSING_PATH);
  if (notFound !== undefined && notFound !== pages.get(`/${NOT_FOUND_FILE}`)) problems.push(`${MISSING_PATH}: the 404 answer is not the body of /${NOT_FOUND_FILE}`);
  const assets = new Set();
  for (const [p, html] of pages) {
    for (const m of forbiddenMarkers(html)) problems.push(`${p}: carries ${m}`);
    const refs = pageAssets(html, urlOf(base, p));
    for (const line of offOriginAssets(refs, base)) problems.push(`${p}: ${line}`);
    for (const a of refs) if (new URL(a).origin === new URL(base).origin) assets.add(new URL(a).pathname);
  }
  problems.push(...(await pool([...assets], async (p) => (await liveOne(base, p, 200, commit, headers)).problems)));
  const update = pages.get(sitePath('update.html'));
  if (update !== undefined) {
    const v = versionProblem(update, version);
    if (v) problems.push(`${sitePath('update.html')}: ${v}`);
  }
  return { problems, count: list.length + 2 + assets.size };
}

/** ask the front page until it names the commit; returns null once it does, or the last problem */
async function waitForCommit(base, commit, headers) {
  let last = '';
  for (let poll = 1; poll <= COMMIT_POLLS; poll += 1) {
    const r = await get(urlOf(base, '/'), headers);
    last = 'error' in r ? r.error : r.res.status === 200 ? commitProblem(r.res.headers.get(COMMIT_HEADER), commit) ?? '' : statusLine('/', r.res, 200);
    if (!last) return null;
    console.log(`site-check: ${base} does not serve ${commit} yet (${last}); asking again in ${RETRY_MS / 1000} s, ${poll} of ${COMMIT_POLLS}`);
    if (poll < COMMIT_POLLS) await new Promise((res) => setTimeout(res, RETRY_MS));
  }
  return last;
}

/** the hosts of the public site */
export const PUBLIC_HOSTS = Object.freeze([new URL(SITE_URL).host, `www.${new URL(SITE_URL).host}`]);

/** the flags of the live mode, and whether each takes a value */
const LIVE_FLAGS = Object.freeze({ '--live': false, '--base': true, '--commit': true, '--attempts': true });

/**
 * The live mode's options from its arguments and environment. Refuses any other argument, so a
 * secret is never taken from the command line; the bypass secret comes from
 * VERCEL_AUTOMATION_BYPASS_SECRET and is sent only to an address that is not the public site.
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 */
export function liveOptions(args, env) {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!Object.hasOwn(LIVE_FLAGS, a)) throw new Error(`site-check: --live does not take ${JSON.stringify(a)}`);
    if (LIVE_FLAGS[/** @type {keyof typeof LIVE_FLAGS} */ (a)]) i += 1;
  }
  const base = argValue(args, '--base', SITE_URL).replace(/\/$/, '');
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error(`site-check: --base takes an https address, not ${JSON.stringify(base)}`);
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) throw new Error(`site-check: --base takes an https origin, not ${JSON.stringify(base)}`);
  const commit = argValue(args, '--commit', '');
  if (commit && !/^[0-9a-f]{40}$/.test(commit)) throw new Error(`site-check: --commit takes a full git SHA, not ${JSON.stringify(commit)}`);
  const attempts = Math.max(1, Number(argValue(args, '--attempts', '3')) || 1);
  const publicSite = PUBLIC_HOSTS.includes(url.host);
  /** @type {Record<string, string>} */
  const headers = {};
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (secret && !publicSite) headers['x-vercel-protection-bypass'] = secret;
  /** @type {string[]} */
  const notes = [];
  if (!publicSite) notes.push(`${url.origin} is not the public site: the sitemap's ${SITE_URL} addresses are read as paths on it`);
  if (!publicSite) notes.push(secret ? 'the Protection Bypass for Automation secret goes along in x-vercel-protection-bypass' : 'no VERCEL_AUTOMATION_BYPASS_SECRET is set, so a protected deployment answers 401');
  if (publicSite && secret) notes.push('VERCEL_AUTOMATION_BYPASS_SECRET is set but not sent: the public site needs no bypass');
  return { base: url.origin, commit: commit || null, attempts, headers, publicSite, notes };
}

function argValue(args, name, fallback) {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const v = args[at + 1];
  if (!v || v.startsWith('--')) throw new Error(`site-check: ${name} needs a value`);
  return v;
}

/** repeat a run until it finds nothing or the attempts are spent; the last run decides */
async function retry(attempts, base, run, success) {
  for (let attempt = 1; ; attempt += 1) {
    const { problems, stop } = await run();
    if (stop) {
      console.error(stop);
      process.exit(1);
    }
    if (!problems.length) {
      console.log(success());
      return;
    }
    console.error(`site-check: run ${attempt} of ${attempts} against ${base}: ${problems.length} problems`);
    for (const p of [...problems].sort()) console.error(`  ${p}`);
    if (attempt >= attempts) process.exit(1);
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const attempts = Math.max(1, Number(argValue(args, '--attempts', '3')) || 1);
  if (args.includes('--live')) {
    const { base, commit, attempts: tries, headers, notes } = liveOptions(args, process.env);
    for (const n of notes) console.log(`site-check: ${n}`);
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    const version = String(pkg.version ?? '');
    if (commit) {
      const stale = await waitForCommit(base, commit, headers);
      if (stale) {
        console.error(`site-check: ${base} still does not serve commit ${commit} after ${COMMIT_POLLS} tries: ${stale}`);
        console.error('site-check: if it names a newer commit, that deployment has its own check; a re-run of an older check fails here by design');
        process.exit(1);
      }
    }
    let count = 0;
    await retry(
      tries,
      base,
      async () => {
        const r = await liveRun(base, commit, version, headers);
        count = r.count;
        return { problems: r.problems };
      },
      () => `site-check: ${base} answers all ${count} addresses with the site's headers and types${commit ? ` from commit ${commit}` : ''}, every script and stylesheet on its own origin, no analytics, speed-insights or toolbar marker in what an anonymous visitor gets, and the update page names ${version}`,
    );
    return;
  }
  const base = argValue(args, '--base', '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) {
    console.error('usage: node scripts/site-check.mjs --live [--base <url>] [--commit <sha>] [--attempts 3]\n       node scripts/site-check.mjs --base <url> [--out out] [--attempts 3]');
    process.exit(2);
  }
  const outDir = path.resolve(argValue(args, '--out', 'out'));
  const requestHeaders = {};
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) requestHeaders['x-vercel-protection-bypass'] = bypass;
  const list = checkList(outDir);
  await retry(
    attempts,
    base,
    async () => {
      const { problems, walled } = await byteRun(base, outDir, list, requestHeaders);
      return { problems, stop: walled ? `site-check: ${base}: ${protectionMessage(walled)}` : '' };
    },
    () => `site-check: ${base} serves all ${list.length} addresses as built, with the site's headers and types`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
