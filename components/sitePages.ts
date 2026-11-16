// The words and links of the site's text pages, in one place: the home page's text before the
// viewer mounts (components/SiteIntro.tsx), the About page and the legal page (app/about,
// app/legal). tests/posture.test.ts reads the first sentences from here; tests/siteExport.test.ts
// finds them, and every link, in the exported HTML. docs/posture.md, rule 2: a first sentence
// names the viewer and its author and no AI word.
import { AUTHOR_PROJECT_URL, RELEASES_URL, REPO_URL } from './links';
import { SITE_NAME } from './site';
import { SITE_URL } from './siteAddress.mjs';

/** the author as the manual's author line and the About badge name him */
export const AUTHOR_NAME = 'Dr. Reza Motaghi';
export const AUTHOR_CREDENTIAL = 'oral and maxillofacial radiologist';

/** the name as the home page's first sentence spells it (it carries the link to his site) */
export const HOME_AUTHOR_NAME = 'Reza Motaghi';

/** the home page before the viewer mounts: what it is and who made it */
export const HOME_LEAD =
  'CBCTScope is a CBCT and 2D radiograph viewer made by Reza Motaghi, a board-certified oral and maxillofacial radiologist.';

/** the privacy sentence, per surface: the web build (and the desktop app, which serves it) or the repository's local app */
export const HOME_PRIVACY_WEB = 'Scans you open are read in this browser tab and never uploaded.';
export const HOME_PRIVACY_LOCAL = 'Scans you open are read on this computer and never uploaded.';

export const HOME_RESEARCH = 'CBCTScope is research software and not a medical device: it displays images and produces no findings or diagnoses.';

/** the noscript line */
export const HOME_NOSCRIPT = 'The viewer needs JavaScript. The manual and the pages below do not.';

/**
 * The home page on a phone (components/SiteIntro.tsx, docs/web-build.md section 7): the intro's
 * heading and three sentences, then where to read with CBCTScope and how to get there. The
 * device decides (components/phone.ts), not the width of a window.
 */
export const PHONE_COMPUTER = `CBCTScope reads scans on a computer. Open ${SITE_URL.replace(/^https:\/\//, '')} there.`;
/**
 * The picture: the manual's MPR still (docs/media/manual/mode-mpr.webp, 3200 px), resized for a
 * phone into public/phone-mpr.webp, from the repository's root, with libwebp's cwebp:
 *   cwebp -q 80 -resize 1200 0 docs/media/manual/mode-mpr.webp -o public/phone-mpr.webp
 * Rerun it whenever that still is recaptured.
 */
export const PHONE_STILL = {
  src: 'phone-mpr.webp',
  width: 1200,
  height: 685,
  alt: 'CBCTScope reading a real CBCT in MPR: axial, sagittal and coronal slices of the jaws with the crosshairs on a molar, a bone-only 3D render, and the tool and window controls beside them.',
};
/**
 * What the third control hands the phone's share sheet (components/ShareLink.tsx): the site's
 * name and canonical address, nothing else.
 */
export const PHONE_SHARE = { title: SITE_NAME, url: SITE_URL } as const;
/**
 * The three controls: the manual, the release page (a phone cannot run the installers), and the
 * site's address sent on, to a computer or to someone else: the phone's share sheet where the
 * browser has one, else a mail.
 */
export const PHONE_ACTIONS: readonly (SiteLink & { testId: string; share?: typeof PHONE_SHARE })[] = [
  { href: 'manual/index.html', label: 'User manual', testId: 'phone-manual' },
  { href: RELEASES_URL, label: 'Desktop app downloads', external: true, testId: 'phone-downloads' },
  {
    // no recipient: the phone's own mail app opens and the reader addresses it; the page sends
    // nothing. Where navigator.share exists a tap opens the share sheet instead, and this href is
    // what remains without JavaScript, without the API, or when the sheet fails to open.
    href: `mailto:?subject=${encodeURIComponent(SITE_NAME)}&body=${encodeURIComponent(SITE_URL)}`,
    label: 'Send this link to a computer or a colleague',
    testId: 'phone-mail',
    share: PHONE_SHARE,
  },
];

/** the About page's title and description */
export const ABOUT_TITLE = 'About CBCTScope, the CBCT and radiograph viewer by Dr. Reza Motaghi';
export const ABOUT_DESCRIPTION =
  'What CBCTScope is, who made it, how to cite it, its licence and how it treats your data. A free, local-first CBCT and 2D radiograph viewer; research software, not a medical device.';

/** the legal page's title and description */
export const LEGAL_TITLE = 'Legal notice and privacy: CBCTScope';
export const LEGAL_DESCRIPTION =
  'Who publishes cbctscope.com, how the site treats your data, the research-use status of the CBCTScope viewer, and its licence.';

/** the update page's title and description (app/update; not indexed, not in the sitemap) */
export const UPDATE_TITLE = 'Check for updates: CBCTScope';
export const UPDATE_DESCRIPTION =
  'Whether a newer version of CBCTScope, the free CBCT and 2D radiograph viewer by Dr. Reza Motaghi, is available, with the direct downloads of the desktop app.';

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

/** the phone page's short row of plain links, after its three controls */
export const PHONE_LINKS: readonly SiteLink[] = HOME_LINKS.filter((l) => ['about', 'legal', REPO_URL].includes(l.href));
