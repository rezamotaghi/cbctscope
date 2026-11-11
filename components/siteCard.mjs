// The share card's two lines (public/og.png), plain JavaScript so that scripts/og.mjs renders
// them straight from here and components/site.ts re-exports them for the app. The viewer and
// its author first, then the privacy line; no agent.

/** card line 1: the viewer and who built it (a short form of SITE_CLAIM) */
export const CARD_CLAIM = 'Local-first CBCT and 2D radiograph viewer, built by an oral and maxillofacial radiologist.';

/** card line 2: the privacy line */
export const CARD_PRIVACY = 'Your scan is read in the browser and never uploaded.';
