import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { OG_IMAGE, SITE_CLAIM, SITE_NAME, SITE_URL } from '@/components/site';
import './globals.css';

const ogImage = { url: OG_IMAGE.path, width: OG_IMAGE.width, height: OG_IMAGE.height, alt: SITE_NAME };

export const metadata: Metadata = {
  title: 'CBCTScope',
  metadataBase: new URL(SITE_URL),
  // the share card: one site URL constant, the README's claim, the rendered public/og.png
  openGraph: { type: 'website', title: SITE_NAME, description: SITE_CLAIM, url: SITE_URL, siteName: SITE_NAME, images: [ogImage] },
  twitter: { card: 'summary_large_image', title: SITE_NAME, description: SITE_CLAIM, images: [ogImage] },
  description:
    process.env.NEXT_PUBLIC_CBCTSCOPE_TARGET === 'web'
      ? 'CBCT viewer in the browser: the scan is read into this tab and never uploaded. Research use only; not a medical device.'
      : 'Local-first CBCT viewer with native AI-agent control (MCP). Research use only; not a medical device.',
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
