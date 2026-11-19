// The public site's address and one-line claim, in one place: the share card (Open Graph and
// Twitter metadata in app/layout.tsx) names them. The address and the contact address live in
// components/siteAddress.mjs, so the build scripts read the same constants.

export { CONTACT_EMAIL, SITE_URL, canonicalUrl } from './siteAddress.mjs';

export { SITE_NAME } from './siteAddress.mjs';

/** the README's one-line claim (components/siteWords.mjs) */
export { SITE_CLAIM } from './siteWords.mjs';

/** the share image's three lines (components/siteCard.mjs), rendered by scripts/og.mjs */
export { CARD_AGENT, CARD_CLAIM, CARD_PRIVACY } from './siteCard.mjs';

/** the share image, rendered by scripts/og.mjs into public/og-card.png (components/siteAddress.mjs) */
export { OG_IMAGE } from './siteAddress.mjs';
