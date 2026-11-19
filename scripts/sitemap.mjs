// sitemap.xml and robots.txt for the web build (docs/web-build.md, section 14), written by
// scripts/build-web.mjs after the export from the pages it actually holds: the home page, the
// About, legal and questions and answers pages, and every manual page. The update page is a page of the site (it is
// served at /update, scripts/vercel-output.mjs) but carries noindex, so the sitemap leaves it out. Every address is the production one
// (components/siteAddress.mjs), whatever base path the build was made under.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalUrl } from '../components/siteAddress.mjs';

/** exported HTML that is not a page of the site: the 404 page, Next's not-found copy, the agent frame */
export const NOT_PAGES = new Set(['404.html', '_not-found.html', 'agent-frame.html']);

/** pages of the site that carry robots noindex (app/update/page.tsx): served, never listed in sitemap.xml */
export const NOINDEX_PAGES = new Set(['update.html']);

/** every exported HTML file, relative to the export, with forward slashes */
function htmlFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '_next') out.push(...htmlFiles(p, base));
    } else if (name.endsWith('.html')) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/**
 * The site path of an exported HTML file: Next's pages without the extension (the host serves
 * about.html at /about, scripts/vercel-output.mjs), an index as its folder, the manual's static
 * pages as they are.
 * @param {string} rel
 */
export function sitePath(rel) {
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  if (!rel.includes('/')) return `/${rel.replace(/\.html$/, '')}`;
  return `/${rel}`;
}

/**
 * The site's pages in an export: their files and production addresses, sorted by address.
 * @param {string} outDir
 * @returns {{ file: string, url: string }[]}
 */
export function sitePages(outDir) {
  return htmlFiles(outDir)
    .filter((rel) => !NOT_PAGES.has(rel))
    .map((rel) => ({ file: rel, url: canonicalUrl(sitePath(rel)) }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Whether sitemap.xml lists an exported file: an HTML file outside _next/ that is a page of the
 * site (not in NOT_PAGES) and carries no noindex (not in NOINDEX_PAGES).
 * @param {string} rel the file relative to the export, with forward slashes
 */
export function inSitemap(rel) {
  return rel.endsWith('.html') && !rel.split('/').includes('_next') && !NOT_PAGES.has(rel) && !NOINDEX_PAGES.has(rel);
}

/**
 * The pages sitemap.xml lists: the site's pages without the noindex ones.
 * @param {string} outDir
 */
export function sitemapPages(outDir) {
  return sitePages(outDir).filter((p) => inSitemap(p.file));
}

/** write sitemap.xml and robots.txt into the export; returns the number of pages listed */
export function writeSitemap(outDir) {
  const pages = sitemapPages(outDir);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pages.map((p) => `  <url><loc>${xmlEscape(p.url)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
  writeFileSync(path.join(outDir, 'sitemap.xml'), xml);
  writeFileSync(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${canonicalUrl('/sitemap.xml')}\n`);
  return pages.length;
}
