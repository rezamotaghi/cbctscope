// The public site's page-view counter (docs/web-build.md, section 3): Vercel Web Analytics in
// its documented plain-HTML form, one external script on the site's own origin, with no inline
// stub and no cookie (vercel.com/docs/analytics/quickstart). Only the site's build
// (scripts/build-web.mjs --site) writes it, and only into the pages sitemap.xml lists: the home
// page, the About and legal pages and every manual page. The update page (which the desktop
// app's Check for Updates opens), the agent frame and the 404 page never carry it, and neither
// does any page of the plain web build, which the desktop app and the local app serve.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { inSitemap } from './sitemap.mjs';

/** the address of Web Analytics' script, under the routes Vercel adds when Web Analytics is enabled */
export const COUNTER_SCRIPT = '/_vercel/insights/script.js';

/** the prefix of every Web Analytics route: a page carries it only as COUNTER_TAG */
export const COUNTER_ROUTES = '/_vercel/insights/';

/** the one tag a counted page carries */
export const COUNTER_TAG = `<script defer src="${COUNTER_SCRIPT}"></script>`;

/** the CSP meta tag build-web writes after the charset; the counter tag follows it */
const CSP_META_RE = /<meta http-equiv="Content-Security-Policy" content="[^"]*"\s*\/?>/i;

/**
 * Whether a page of the export is counted: exactly the pages sitemap.xml lists.
 * @param {string} rel the file relative to the export, with forward slashes
 */
export function isCounted(rel) {
  return inSitemap(rel);
}

/**
 * The page with COUNTER_TAG written right after its CSP meta tag. Throws when the page already
 * refers to the routes or has no CSP meta tag.
 * @param {string} html
 */
export function addCounter(html) {
  if (html.includes(COUNTER_ROUTES)) throw new Error('the page already refers to the Web Analytics routes');
  const csp = CSP_META_RE.exec(html);
  if (!csp) throw new Error('the page has no CSP meta tag to anchor the counter');
  return html.replace(csp[0], `${csp[0]}${COUNTER_TAG}`);
}

/**
 * Why a page does not follow the counter rule, or null when it does: a counted page carries
 * COUNTER_TAG exactly once and no other reference to the routes; any other page carries none.
 * @param {string} html
 * @param {boolean} counted
 */
export function counterProblem(html, counted) {
  const refs = html.split(COUNTER_ROUTES).length - 1;
  const tags = html.split(COUNTER_TAG).length - 1;
  if (!counted) return refs ? `carries ${refs} references to ${COUNTER_ROUTES}, expected none (the page is not counted)` : null;
  if (tags !== 1) return `carries the counter tag ${tags} times, expected once`;
  if (refs !== 1) return `carries ${refs} references to ${COUNTER_ROUTES}, expected only the counter tag`;
  return null;
}

/**
 * The HTML pages under a folder that refer to the Web Analytics routes, relative to it with
 * forward slashes: empty for a plain web build, the sitemap's pages for the site's build. The
 * desktop scripts refuse a folder where this is not empty (scripts/desktop.mjs).
 * @param {string} dir
 */
export function pagesWithCounter(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...pagesWithCounter(p, base));
    else if (name.endsWith('.html') && readFileSync(p, 'utf8').includes(COUNTER_ROUTES)) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}
