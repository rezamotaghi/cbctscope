// The public site's address, its contact address and the project's other addresses, in one
// place, plain JavaScript so the build scripts (scripts/build-web.mjs writes sitemap.xml,
// robots.txt and llms.txt, scripts/manual-html.mjs the manual's canonical links) and the app (components/site.ts re-exports both) read the
// same constant. A link for people and crawlers, never a request the page makes
// (tests/noAbsoluteUrls.test.ts allows SITE_URL here).

export const SITE_URL = 'https://cbctscope.com';

/** the author's own site: linked from his name on the home page, About, legal and manual pages (components/links.ts re-exports it) */
export const AUTHOR_URL = 'https://rezamotaghi.com';

/** the author's identity in structured data: the @id of the Person record on his own site */
export const AUTHOR_PERSON_ID = `${AUTHOR_URL}/#person`;

/** the viewer's and the site's identities in structured data (components/jsonLd.ts, the manual's pages) */
export const SOFTWARE_ID = `${SITE_URL}/#software`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/** the author's page on this project */
export const AUTHOR_PROJECT_URL = 'https://rezamotaghi.com/cbctscope';

/** the source code repository */
export const REPO_URL = 'https://github.com/rezamotaghi/cbctscope';

/** the DOI resolver: a citation's DOI as a link the reader clicks (components/citation.ts) */
export const DOI_RESOLVER = 'https://doi.org/';

/**
 * The project's concept DOI on Zenodo, which always resolves to the newest archived version.
 * The site and the app cite it whatever CITATION.cff's doi: holds (components/citation.ts);
 * tests/manual.test.ts checks that a version bump resets CITATION.cff to it.
 */
export const CONCEPT_DOI = '10.5281/zenodo.21431452';

/** the author's registered protocol for grading AI-written radiograph reports: linked from the About page's author paragraph only */
export const RADIGRADE_URL = 'https://radigrade.com';

/** the share image, rendered by scripts/og.mjs into public/og-card.png: the site's pages and the manual's name it */
export const OG_IMAGE = Object.freeze({ path: '/og-card.png', width: 1200, height: 630 });

/** the site's name, as the share card and the structured data give it */
export const SITE_NAME = 'CBCTScope';

/** the one contact address, named on the legal page */
export const CONTACT_EMAIL = 'contact@cbctscope.com';

/**
 * The canonical address of a page of the site: always the production address, whatever base
 * path a build was made under (a sub-path build's pages name cbctscope.com too). The home
 * page is the bare address, as Next writes its canonical link.
 * @param {string} pathname the page's path from the site root, starting with a slash
 * @returns {string}
 */
export function canonicalUrl(pathname) {
  if (!pathname.startsWith('/')) throw new Error(`canonicalUrl: ${pathname} does not start with a slash`);
  return pathname === '/' ? SITE_URL : `${SITE_URL}${pathname}`;
}
