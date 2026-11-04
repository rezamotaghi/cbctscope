// The public site's address and one-line claim, in one place: the share card (Open Graph and
// Twitter metadata in app/layout.tsx) names them. A link for people and crawlers, never a
// request the page makes (tests/noAbsoluteUrls.test.ts allows this constant here only).

export const SITE_URL = 'https://cbctscope.com';

export const SITE_NAME = 'CBCTScope';

/** the README's one-line claim */
export const SITE_CLAIM =
  'A complete, local-first CBCT and 2D radiograph viewer, built by a board-certified oral and maxillofacial radiologist.';

/** the share image, rendered by scripts/og.mjs into public/og.png */
export const OG_IMAGE = { path: '/og.png', width: 1200, height: 630 } as const;
