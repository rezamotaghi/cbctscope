import { NextRequest, NextResponse } from 'next/server';
import { clearLocalSource, getLocalSource, setLocalSource } from '@/lib/server/localSource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/cbct/source → { active, label, count } (label = folder/file basename; the full path
// stays server-side — the browser only ever sees what the user themselves picked).
export async function GET() {
  const s = getLocalSource();
  return NextResponse.json({ active: !!s, label: s?.label ?? null, count: s?.volumes.length ?? 0 });
}

// POST /api/cbct/source { path } → point the viewer at a local folder / DICOMDIR / file.
export async function POST(req: NextRequest) {
  let body: { path?: string };
  try {
    body = (await req.json()) as { path?: string };
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  if (typeof body.path !== 'string') return NextResponse.json({ error: 'path required' }, { status: 400 });

  const result = setLocalSource(body.path);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, label: result.label, count: result.count });
}

// DELETE /api/cbct/source → close the opened source (back to the demo phantom alone).
export async function DELETE() {
  clearLocalSource();
  return NextResponse.json({ ok: true });
}
