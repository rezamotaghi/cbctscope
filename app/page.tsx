// The home page: the CBCT reading screen (components/HomeViewer.tsx, client-only), which shows
// the site's text and links until it mounts; a noscript block for a browser without JavaScript;
// the structured data; and the canonical address. CITATION.cff is read here, at build time,
// for the Help menu's Cite dialogue.
import type { Metadata } from 'next';
import HomeViewer from '@/components/HomeViewer';
import { jsonLdText, softwareJsonLd, websiteJsonLd } from '@/components/jsonLd';
import { canonicalUrl } from '@/components/site';
import { readCitation } from '@/lib/server/citation';

export const metadata: Metadata = { alternates: { canonical: canonicalUrl('/') } };

export default function Page() {
  const citation = readCitation();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(softwareJsonLd(citation)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(websiteJsonLd()) }} />
      <HomeViewer citation={citation} />
      <noscript>
        {/* without JavaScript: the intro's line that the viewer needs it and the manual does not
            (components/SiteIntro.tsx) takes the place of "The viewer is loading.", above the
            same links. A style rather than markup in here: some engines parse this block while
            still hiding it, and a style inside it applies even then. */}
        <style>{'.site-loading{display:none}.site-nojs{display:block}'}</style>
      </noscript>
    </>
  );
}
