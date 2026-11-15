'use client';
// The home page: the CBCT reading screen, or in the web build on a phone the phone page
// (components/phone.ts decides by the device, never by a window's width). Cornerstone touches
// WebGL/WASM, so the viewer is client-only (ssr: false); until its code has loaded, the page
// shows SiteIntro. The exported HTML is SiteIntro alone, which is also the phone page:
// app/globals.css shows its phone part on a phone before any script runs, and on a phone the
// viewer is never mounted, so its code, its WASM and the volume are never requested. On any
// other device the viewer mounts and stays mounted at every width and zoom; a window too narrow
// to read in gets a notice above it (CbctApp). The repository's local app always mounts the viewer.
import dynamic from 'next/dynamic';
import { useSyncExternalStore } from 'react';
import type { Citation } from './citation';
import { IS_DESKTOP } from './cbct/shell';
import { PHONE_MEDIA } from './phone';
import SiteIntro from './SiteIntro';

const WEB = process.env.NEXT_PUBLIC_CBCTSCOPE_TARGET === 'web';

const CbctApp = dynamic(() => import('@/components/cbct/CbctApp'), { ssr: false, loading: () => <SiteIntro /> });

const subscribe = (cb: () => void) => {
  const m = window.matchMedia(PHONE_MEDIA);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
/** a phone, in the web build in a browser (the desktop app is never one) */
const phoneNow = () => WEB && !IS_DESKTOP && window.matchMedia(PHONE_MEDIA).matches;
/** the export: no device yet; the intro is rendered and the stylesheet decides what it shows */
const unknown = () => null;
/** once mounted, the viewer stays: no later change of the media features takes a reading away */
let viewerMounted = false;

export default function HomeViewer({ citation }: { citation: Citation }) {
  const phone = useSyncExternalStore<boolean | null>(subscribe, phoneNow, unknown);
  if (WEB && phone !== false && !viewerMounted) return <SiteIntro />;
  if (phone === false) viewerMounted = true;
  return <CbctApp citation={citation} />;
}
