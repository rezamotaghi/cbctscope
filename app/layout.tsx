import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'CBCTScope',
  description:
    'Local-first CBCT viewer with native AI-agent control (MCP). Research use only; not a medical device.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning: privacy extensions (e.g. the GA opt-out add-on) stamp attributes
  // like data-google-analytics-opt-out onto <html> before React hydrates. This suppresses only
  // THIS element's attribute diffs — never real mismatches in the children below.
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
