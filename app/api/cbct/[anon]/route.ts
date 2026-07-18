// GET /api/cbct/[anon] — geometry + default-window metadata for one volume. Triggers
// assembly (server LRU) so the follow-up /data fetch is a hit.
import { NextRequest, NextResponse } from 'next/server';
import { VOLUME_ID_RE } from '@/lib/server/dicom';
import { getAssembledLocalVolume, isLocalCbctId } from '@/lib/server/localSource';
import { getFusedVolume, isFusedCbctId } from '@/lib/server/fused';
import { getPhantomVolume, isPhantomId } from '@/lib/server/phantom';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ anon: string }> }) {
  const { anon } = await params;
  if (!VOLUME_ID_RE.test(anon)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  try {
    const vol = isPhantomId(anon)
      ? getPhantomVolume()
      : isFusedCbctId(anon)
        ? getFusedVolume(anon)
        : isLocalCbctId(anon)
          ? getAssembledLocalVolume(anon)
          : null;
    if (!vol) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(vol.meta);
  } catch (err) {
    console.error(`[api/cbct] meta failed for ${anon}:`, err);
    return NextResponse.json({ error: 'volume unavailable' }, { status: 404 });
  }
}
