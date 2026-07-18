'use client';
// The CBCT reading screen. Cornerstone touches WebGL/WASM, so the whole app is
// client-only (ssr: false).
import dynamic from 'next/dynamic';

const CbctApp = dynamic(() => import('@/components/cbct/CbctApp'), { ssr: false });

export default function Page() {
  return <CbctApp />;
}
