// POST /api/cbct/fused — register a client-baked stitched volume in server memory.
// Body: raw Int16 LE voxels (x-fastest / y / z-ascending). Geometry travels in the
// `x-cbct-fused-meta` header as compact JSON (dims/spacing/origin/defaultVoi/label/year). The
// registered `fused_<hex>` id is then served by /api/cbct, /api/cbct/[anon], and .../data like
// any other volume. Session-scoped, memory-only — fused volumes are derived and stay local.
import { NextRequest, NextResponse } from 'next/server';
import { registerFused } from '@/lib/server/fused';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 400_000_000; // ~200M voxels — matches the client bake cap with headroom

export async function POST(req: NextRequest) {
  const metaRaw = req.headers.get('x-cbct-fused-meta');
  if (!metaRaw) return NextResponse.json({ error: 'missing fused metadata header' }, { status: 400 });
  let meta: {
    dims: [number, number, number];
    spacing: [number, number, number];
    origin: [number, number, number];
    defaultVoi: { center: number; width: number };
    label: string;
    year: string;
  };
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    return NextResponse.json({ error: 'bad fused metadata' }, { status: 400 });
  }
  const [nx, ny, nz] = meta.dims ?? [];
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || !Number.isInteger(nz) || nx < 1 || ny < 1 || nz < 1) {
    return NextResponse.json({ error: 'bad dims' }, { status: 400 });
  }
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'fused volume too large' }, { status: 413 });
  }
  const expected = nx * ny * nz * 2;
  if (body.byteLength !== expected) {
    return NextResponse.json({ error: `voxel count mismatch (got ${body.byteLength}, expected ${expected})` }, { status: 400 });
  }
  const data = Buffer.from(body); // own the bytes; served back verbatim as the voxel buffer
  const { anon, label } = registerFused({
    dims: meta.dims,
    spacing: meta.spacing,
    origin: meta.origin,
    defaultVoi: meta.defaultVoi,
    label: meta.label,
    year: meta.year,
    data,
  });
  return NextResponse.json({ anon, label });
}
