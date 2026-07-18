// GET /api/cbct — list openable CBCT volumes: any user-opened local source (label + geometry
// only — file paths never leave the server), session-fused stitches, and the built-in
// synthetic demo phantom (always available, zero patient data).
import { NextResponse } from 'next/server';
import { listLocalVolumes } from '@/lib/server/localSource';
import { listFusedVolumes } from '@/lib/server/fused';
import { getPhantomVolume } from '@/lib/server/phantom';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let volumes: unknown[] = [];
  try {
    volumes = [...listFusedVolumes(), ...listLocalVolumes()];
  } catch (err) {
    console.error('[api/cbct] volume list failed:', err); // server-side only — never echo fs paths
  }
  try {
    const m = getPhantomVolume().meta;
    volumes = [
      ...volumes,
      {
        anon: m.anon,
        kind: m.kind,
        dims: m.dims,
        spacing: m.spacing,
        fov: m.fov,
        region: m.region,
        year: m.year,
        pair: null,
        label: 'Synthetic phantom (demo)',
      },
    ];
  } catch (err) {
    console.error('[api/cbct] phantom failed:', err);
  }
  return NextResponse.json({ volumes });
}
