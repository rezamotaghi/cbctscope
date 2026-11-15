'use client';
// The home page: the CBCT reading screen from 768 px of width up, the phone page below it
// (components/PhoneLanding.tsx), decided by the width and again whenever it changes. Cornerstone
// touches WebGL/WASM, so the viewer is client-only (ssr: false); until its code has loaded, the
// page shows SiteIntro. The exported HTML, rendered without a width, carries both SiteIntro and
// the phone page, and app/globals.css shows the one that fits before any script runs. Below
// 768 px the viewer is never mounted: no panes, no volume load. The desktop app's window is
// never that narrow.
import dynamic from 'next/dynamic';
import { useSyncExternalStore } from 'react';
import type { Citation } from './citation';
import PhoneLanding from './PhoneLanding';
import SiteIntro from './SiteIntro';

const CbctApp = dynamic(() => import('@/components/cbct/CbctApp'), { ssr: false, loading: () => <SiteIntro /> });

/** the viewer's width; app/globals.css switches at the same query, negated */
export const VIEWER_MEDIA = '(min-width: 768px)';

const subscribe = (cb: () => void) => {
  const m = window.matchMedia(VIEWER_MEDIA);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
const wideNow = () => window.matchMedia(VIEWER_MEDIA).matches;
/** the export and the first render in the browser: width unknown, the stylesheet decides */
const unknown = () => null;

export default function HomeViewer({ citation }: { citation: Citation }) {
  const wide = useSyncExternalStore<boolean | null>(subscribe, wideNow, unknown);
  if (wide === null)
    return (
      <>
        <SiteIntro />
        <PhoneLanding />
      </>
    );
  return wide ? <CbctApp citation={citation} /> : <PhoneLanding />;
}
