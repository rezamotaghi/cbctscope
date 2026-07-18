import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'node:child_process';
import { setLocalSource } from '@/lib/server/localSource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // the user may take a while in the dialog

// POST /api/cbct/source/pick { kind: 'folder' | 'file' }
// A NATIVE macOS chooser (AppleScript) on the machine running the server — which for this
// local single-user tool is the same machine as the browser. Folder = a CBCT export tree
// (DICOMDIR / slice series / multiframes); file = one DICOMDIR, one multiframe volume, or one
// slice of a series (opens the whole series). Cancel is a normal outcome, not an error.
// Non-macOS platforms: POST /api/cbct/source with { path } instead.
export async function POST(req: NextRequest) {
  if (process.platform !== 'darwin') {
    return NextResponse.json(
      { error: 'native chooser is macOS-only — POST /api/cbct/source with { path } instead' },
      { status: 501 },
    );
  }
  let kind = 'folder';
  try {
    const body = (await req.json()) as { kind?: string };
    if (body.kind === 'file') kind = 'file';
  } catch {
    /* default folder */
  }

  const chooser =
    kind === 'file'
      ? 'choose file with prompt "Choose a CBCT file (DICOMDIR / multiframe DICOM / one slice of a series)"'
      : 'choose folder with prompt "Choose a CBCT export folder (DICOMDIR or DICOM files)"';
  const script = `tell application "Finder"
\tactivate
\tset p to POSIX path of (${chooser})
end tell
p`;

  const picked = await new Promise<{ path?: string; canceled?: boolean; error?: string }>((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 290_000 }, (err, stdout, stderr) => {
      if (err) {
        // "User canceled." (-128) is the normal dismiss path.
        if (String(stderr).includes('-128') || String(stderr).toLowerCase().includes('cancel')) {
          resolve({ canceled: true });
        } else {
          console.error('[api/cbct/source/pick] osascript failed:', stderr || err.message);
          resolve({ error: 'could not open the system dialog' });
        }
        return;
      }
      resolve({ path: stdout.trim() });
    });
  });

  if (picked.canceled) return NextResponse.json({ canceled: true });
  if (!picked.path) return NextResponse.json({ error: picked.error ?? 'no path' }, { status: 500 });

  const result = setLocalSource(picked.path);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, label: result.label, count: result.count });
}
