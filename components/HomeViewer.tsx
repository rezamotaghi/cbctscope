'use client';
// The CBCT reading screen. Cornerstone touches WebGL/WASM, so the whole app is client-only
// (ssr: false). Until its code has loaded, the page shows SiteIntro: the exported HTML carries
// that text and those links before any script runs, and the viewer takes their place.
import dynamic from 'next/dynamic';
import type { Citation } from './citation';
import SiteIntro from './SiteIntro';

const CbctApp = dynamic(() => import('@/components/cbct/CbctApp'), { ssr: false, loading: () => <SiteIntro /> });

export default function HomeViewer({ citation }: { citation: Citation }) {
  return <CbctApp citation={citation} />;
}
