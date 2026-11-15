// The share card's three lines (public/og-card.png), plain JavaScript so that scripts/og.mjs
// renders them straight from here and components/site.ts re-exports them for the app. The viewer
// and its author first, then the privacy line, then the agent line: what the agent may do and
// who reads, in one breath.

/** card line 1: the viewer and who built it (a short form of SITE_CLAIM) */
export const CARD_CLAIM = 'Local-first CBCT and 2D radiograph viewer, built by an oral and maxillofacial radiologist.';

/** card line 2: the privacy line */
export const CARD_PRIVACY = 'Your scan is read in the browser and never uploaded.';

/** card line 3: the agent, and its limit */
export const CARD_AGENT = 'Agent-native: an AI agent can move the camera, the human reads.';
