// The public site's address and one-line claim, in one place: the share card (Open Graph and
// Twitter metadata in app/layout.tsx) names them. The address and the contact address live in
// components/siteAddress.mjs, so the build scripts read the same constants.

export { CONTACT_EMAIL, SITE_URL, canonicalUrl } from './siteAddress.mjs';

export const SITE_NAME = 'CBCTScope';

/** the README's one-line claim */
export const SITE_CLAIM =
  'A complete, local-first CBCT and 2D radiograph viewer, built by a board-certified oral and maxillofacial radiologist.';

/** the share image's three lines (components/siteCard.mjs), rendered by scripts/og.mjs */
export { CARD_AGENT, CARD_CLAIM, CARD_PRIVACY } from './siteCard.mjs';

/** the share image, rendered by scripts/og.mjs into public/og-card.png */
export const OG_IMAGE = { path: '/og-card.png', width: 1200, height: 630 } as const;
