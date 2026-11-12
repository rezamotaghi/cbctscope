// The public site's address and its contact address, in one place, plain JavaScript so the
// build scripts (scripts/build-web.mjs writes sitemap.xml and robots.txt, scripts/manual-html.mjs
// the manual's canonical links) and the app (components/site.ts re-exports both) read the
// same constant. A link for people and crawlers, never a request the page makes
// (tests/noAbsoluteUrls.test.ts allows SITE_URL here).

export const SITE_URL = 'https://cbctscope.com';

/** the one contact address, named on the legal page */
export const CONTACT_EMAIL = 'contact@cbctscope.com';

/**
 * The canonical address of a page of the site: always the production address, whatever base
 * path a build was made under (the staging build's pages name cbctscope.com too). The home
 * page is the bare address, as Next writes its canonical link.
 * @param {string} pathname the page's path from the site root, starting with a slash
 * @returns {string}
 */
export function canonicalUrl(pathname) {
  if (!pathname.startsWith('/')) throw new Error(`canonicalUrl: ${pathname} does not start with a slash`);
  return pathname === '/' ? SITE_URL : `${SITE_URL}${pathname}`;
}
