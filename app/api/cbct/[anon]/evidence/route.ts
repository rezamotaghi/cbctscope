// GET/PUT /api/cbct/[anon]/evidence — the per-volume annotation sidecar (annotations, saved
// views, 3D ROIs). One JSON file per volume under the app-data folder; contents are display
// labels, world-mm coordinates, and HU statistics only — never pixel data.
import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { VOLUME_ID_RE } from '@/lib/server/dicom';
import { EVIDENCE_DIR } from '@/lib/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 8 * 1024 * 1024; // annotations are small; 8 MB is a runaway guard

export async function GET(_req: NextRequest, { params }: { params: Promise<{ anon: string }> }) {
  const { anon } = await params;
  if (!VOLUME_ID_RE.test(anon)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const file = path.join(EVIDENCE_DIR, `${anon}.json`);
  try {
    if (!fs.existsSync(file)) return NextResponse.json({ exists: false });
    return NextResponse.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    console.error(`[api/cbct] evidence read failed for ${anon}:`, err);
    return NextResponse.json({ error: 'evidence unreadable' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ anon: string }> }) {
  const { anon } = await params;
  if (!VOLUME_ID_RE.test(anon)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = await req.text();
  if (body.length > MAX_BYTES) return NextResponse.json({ error: 'too large' }, { status: 413 });
  try {
    JSON.parse(body); // must at least be JSON
  } catch {
    return NextResponse.json({ error: 'not JSON' }, { status: 400 });
  }
  try {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${anon}.json`), body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[api/cbct] evidence write failed for ${anon}:`, err);
    return NextResponse.json({ error: 'evidence unwritable' }, { status: 500 });
  }
}
