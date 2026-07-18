// GET /api/cbct/[anon]/data — normalized voxel buffer: Int16 LE HU, x-fastest / y /
// z-ascending. Serves opened local, session-fused, and demo-phantom volumes through the
// same contract.
import { NextRequest, NextResponse } from 'next/server';
import { VOLUME_ID_RE } from '@/lib/server/dicom';
import { getAssembledLocalVolume, isLocalCbctId } from '@/lib/server/localSource';
import { getFusedVolume, isFusedCbctId } from '@/lib/server/fused';
import { getPhantomVolume, isPhantomId } from '@/lib/server/phantom';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ anon: string }> }) {
  const { anon } = await params;
  if (!VOLUME_ID_RE.test(anon)) return new NextResponse('not found', { status: 404 });
  try {
    const vol = isPhantomId(anon)
      ? getPhantomVolume()
      : isFusedCbctId(anon)
        ? getFusedVolume(anon)
        : isLocalCbctId(anon)
          ? getAssembledLocalVolume(anon)
          : null;
    if (!vol) return new NextResponse('not found', { status: 404 });
    const { data } = vol;
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(data.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error(`[api/cbct] data failed for ${anon}:`, err);
    return new NextResponse('volume unavailable', { status: 404 });
  }
}
