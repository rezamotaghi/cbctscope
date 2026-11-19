// The viewer's links to the project (docs/web-build.md, section 7): links the reader clicks,
// never requests the page makes. tests/noAbsoluteUrls.test.ts lists these constants.
import { REPO_URL, SITE_URL } from './siteAddress.mjs';

/** the source code: the Help menu and the About popover (components/siteAddress.mjs, which llms.txt also reads) */
export { REPO_URL };

/** the latest release, every file and its notes: the header's download menu (components/downloads.ts), plain browser only */
export const RELEASES_URL = 'https://github.com/rezamotaghi/cbctscope/releases/latest';

/** the website's update page: the desktop app's Check for Updates item and its version panel (components/updateCheck.ts adds the installed version after the #) */
export const UPDATE_URL = `${SITE_URL}/update`;

/** the consented, bone-only stills of a real scan: the first-run status line's link */
export const STILLS_URL = `${REPO_URL}#the-interface-at-a-glance`;

/** the licence text in the repository: the About and legal pages */
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

/** the author's own site, and his page on this project (CITATION.cff names the site) */
export { AUTHOR_PROJECT_URL, AUTHOR_URL, RADIGRADE_URL } from './siteAddress.mjs';

/** the author's ORCID record, as CITATION.cff states it, and his GitHub profile, as REPO_URL shows it */
export const AUTHOR_ORCID = 'https://orcid.org/0009-0005-3194-1879';
export const AUTHOR_GITHUB = 'https://github.com/rezamotaghi';

/** the DOI resolver and the project's concept DOI (components/siteAddress.mjs) */
export { CONCEPT_DOI, DOI_RESOLVER } from './siteAddress.mjs';

/** the legal page's links: the site host's and the installers' host's own privacy statements, and the Austrian data protection authority */
export const VERCEL_PRIVACY_URL = 'https://vercel.com/legal/privacy-policy';
export const GITHUB_PRIVACY_URL = 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement';
export const DSB_URL = 'https://www.dsb.gv.at';
