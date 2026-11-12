// The words and links of the site's text pages, in one place: the home page's text before the
// viewer mounts (components/SiteIntro.tsx), the About page and the legal page (app/about,
// app/legal). tests/posture.test.ts reads the first sentences from here; tests/siteExport.test.ts
// finds them, and every link, in the exported HTML. docs/posture.md, rule 2: a first sentence
// names the viewer and its author and no AI word.
import { AUTHOR_PROJECT_URL, REPO_URL } from './links';

/** the author as the manual's author line and the About badge name him */
export const AUTHOR_NAME = 'Dr. Reza Motaghi';
export const AUTHOR_CREDENTIAL = 'oral and maxillofacial radiologist';

/** the home page before the viewer mounts: what it is and who made it */
export const HOME_LEAD =
  'CBCTScope is a CBCT and 2D radiograph viewer made by Reza Motaghi, a board-certified oral and maxillofacial radiologist.';

/** the privacy sentence, per surface: the web build (and the desktop app, which serves it) or the repository's local app */
export const HOME_PRIVACY_WEB = 'Scans you open are read in this browser tab and never uploaded.';
export const HOME_PRIVACY_LOCAL = 'Scans you open are read on this computer and never uploaded.';

export const HOME_RESEARCH = 'CBCTScope is research software and not a medical device: it displays images and produces no findings or diagnoses.';

/** the noscript line */
export const HOME_NOSCRIPT = 'The viewer needs JavaScript. The manual and the pages below do not.';

/** the About page's title and description */
export const ABOUT_TITLE = 'About CBCTScope, the CBCT and radiograph viewer by Dr. Reza Motaghi';
export const ABOUT_DESCRIPTION =
  'What CBCTScope is, who made it, how to cite it, its licence and how it treats your data. A free, local-first CBCT and 2D radiograph viewer; research software, not a medical device.';

/** the legal page's title and description */
export const LEGAL_TITLE = 'Legal notice and privacy: CBCTScope';
export const LEGAL_DESCRIPTION =
  'Who publishes cbctscope.com, how the site treats your data, the research-use status of the CBCTScope viewer, and its licence.';

/** the About page's first paragraph: the README's own description, shortened */
export const ABOUT_LEAD =
  'CBCTScope is a complete, local-first CBCT and 2D radiograph viewer, built by Reza Motaghi, a board-certified oral and maxillofacial radiologist.';

/** the legal notice's one-line statement of what the site is for: the legal page's first sentence */
export const LEGAL_PURPOSE = 'This site publishes CBCTScope, a free CBCT and 2D radiograph viewer by Reza Motaghi, and its manual.';

/** the eight reading guides, in the manual's order: [manual page, the guide's name] */
export const READING_GUIDES: readonly (readonly [string, string])[] = [
  ['mpr.html', 'MPR'],
  ['grid.html', 'Grid'],
  ['pano.html', 'Pano'],
  ['tmj.html', 'TMJ'],
  ['reslice.html', 'Reslice'],
  ['ceph.html', 'Ceph'],
  ['region.html', 'Region'],
  ['stitch.html', 'Stitch'],
];

export interface SiteLink {
  href: string;
  label: string;
  /** true for a page of another site, opened in a new tab */
  external?: boolean;
}

/**
 * Every link the home page carries before the viewer mounts, relative to the viewer's page so a
 * base path holds (manual/ and the pages sit beside it).
 */
export const HOME_LINKS: readonly SiteLink[] = [
  { href: 'manual/index.html', label: 'User manual' },
  ...READING_GUIDES.map(([page, name]) => ({ href: `manual/${page}`, label: `${name} reading guide` })),
  { href: 'about', label: 'About CBCTScope' },
  { href: 'legal', label: 'Legal notice and privacy' },
  { href: REPO_URL, label: 'Source code', external: true },
  { href: AUTHOR_PROJECT_URL, label: "The author's project page", external: true },
];
