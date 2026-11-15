import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CARD_AGENT, OG_IMAGE, SITE_CLAIM, SITE_NAME, SITE_URL } from '@/components/site';
import './globals.css';

const ogImage = { url: OG_IMAGE.path, width: OG_IMAGE.width, height: OG_IMAGE.height, alt: SITE_NAME };

/** the page title, the share card's title and the Twitter title: what this is, in one line */
const TITLE = 'CBCTScope: CBCT and radiograph viewer in your browser';

/** the text beside the share card: the claim, then the agent line */
const CARD_TEXT = `${SITE_CLAIM} ${CARD_AGENT}`;

export const metadata: Metadata = {
  title: TITLE,
  metadataBase: new URL(SITE_URL),
  // the share card: one site URL constant, the README's claim, the rendered public/og-card.png (its three
  // lines come from components/siteCard.mjs); the card's text ends with the agent line
  openGraph: { type: 'website', title: TITLE, description: CARD_TEXT, url: SITE_URL, siteName: SITE_NAME, images: [ogImage] },
  twitter: { card: 'summary_large_image', title: TITLE, description: CARD_TEXT, images: [ogImage] },
  description:
    process.env.NEXT_PUBLIC_CBCTSCOPE_TARGET === 'web'
      ? 'CBCT viewer in the browser: the scan is read into this tab and never uploaded. Research use only; not a medical device.'
      : 'Local-first CBCT and 2D radiograph viewer. Research use only; not a medical device.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning: privacy extensions (e.g. the GA opt-out add-on) stamp attributes
  // like data-google-analytics-opt-out onto <html> before React hydrates. This suppresses only
  // THIS element's attribute diffs, never real mismatches in the children below.
  // The web build's CSP meta tag is written into the exported HTML by scripts/build-web.mjs
  // (components/webCsp.mjs says why it is not rendered here).
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
