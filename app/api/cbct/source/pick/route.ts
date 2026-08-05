import { NextRequest, NextResponse } from 'next/server';
import { chooseNative } from '@/lib/server/nativeChooser';
import { setLocalSource } from '@/lib/server/localSource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // the user may take a while in the dialog

// POST /api/cbct/source/pick { kind: 'folder' | 'file' }
// A native chooser on the machine running the server (lib/server/nativeChooser) — which for
// this local single-user tool is the same machine as the browser. Folder = a CBCT export tree
// (DICOMDIR / slice series / multiframes); file = one DICOMDIR, one multiframe volume, or one
// slice of a series (opens the whole series). Cancel is a normal outcome, not an error.
export async function POST(req: NextRequest) {
  let kind: 'folder' | 'file' = 'folder';
  try {
    const body = (await req.json()) as { kind?: string };
    if (body.kind === 'file') kind = 'file';
  } catch {
    /* default folder */
  }

  const picked = await chooseNative(
    kind,
    kind === 'file'
      ? 'Choose a CBCT file (DICOMDIR / multiframe DICOM / one slice of a series)'
      : 'Choose a CBCT export folder (DICOMDIR or DICOM files)',
  );

  if ('canceled' in picked) return NextResponse.json({ canceled: true });
  if ('error' in picked)
    return NextResponse.json({ error: picked.error }, { status: picked.unsupported ? 501 : 500 });

  const result = setLocalSource(picked.path);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, label: result.label, count: result.count });
}
