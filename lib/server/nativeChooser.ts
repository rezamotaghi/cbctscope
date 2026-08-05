import { execFile } from 'node:child_process';
import { homedir } from 'node:os';

// A native "choose a file/folder" dialog on the machine running the server — which for this
// local single-user tool is the same machine as the browser. The dialog runs server-side so
// the picked absolute path never reaches the browser; only the server reads it.
// macOS: AppleScript via Finder. Windows: the WinForms dialogs through the built-in
// PowerShell. Linux: zenity, then kdialog; a desktop with neither falls back to
// POST /api/cbct/source with { path }. Cancel is a normal outcome, not an error.

export type ChooserKind = 'folder' | 'file';

export type ChooserResult =
  | { path: string }
  | { canceled: true }
  | { error: string; unsupported?: boolean };

const TIMEOUT_MS = 290_000; // the user may take a while in the dialog

type RunOutcome = { stdout: string; stderr: string; err?: Error & { code?: number | string | null } };

function run(cmd: string, args: string[]): Promise<RunOutcome> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      resolve({ stdout: String(stdout), stderr: String(stderr), err: err ?? undefined });
    });
  });
}

async function chooseMac(kind: ChooserKind, prompt: string): Promise<ChooserResult> {
  const p = prompt.replace(/[\\"]/g, '\\$&');
  const chooser =
    kind === 'file' ? `choose file with prompt "${p}"` : `choose folder with prompt "${p}"`;
  const script = `tell application "Finder"
\tactivate
\tset p to POSIX path of (${chooser})
end tell
p`;
  const { stdout, stderr, err } = await run('osascript', ['-e', script]);
  if (err) {
    // "User canceled." (-128) is the normal dismiss path.
    if (stderr.includes('-128') || stderr.toLowerCase().includes('cancel')) return { canceled: true };
    console.error('[nativeChooser] osascript failed:', stderr || err.message);
    return { error: 'could not open the system dialog' };
  }
  return { path: stdout.trim() };
}

async function chooseWindows(kind: ChooserKind, prompt: string): Promise<ChooserResult> {
  const p = prompt.replace(/'/g, "''");
  // The topmost owner form keeps the dialog from opening behind the browser; UTF-8 output
  // keeps accented folder names intact through stdout.
  const dialog =
    kind === 'file'
      ? `$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = '${p}'; $d.Filter = 'All files (*.*)|*.*'; $sel = { $d.FileName }`
      : `$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${p}'; $sel = { $d.SelectedPath }`;
  const script = `Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${dialog}; $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }; if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine((& $sel)) }`;
  const { stdout, stderr, err } = await run('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
  if (err) {
    console.error('[nativeChooser] powershell failed:', stderr || err.message);
    return { error: 'could not open the system dialog' };
  }
  const path = stdout.trim();
  return path ? { path } : { canceled: true };
}

async function chooseLinux(kind: ChooserKind, prompt: string): Promise<ChooserResult> {
  const home = homedir();
  const helpers: Array<{ cmd: string; args: string[] }> = [
    {
      cmd: 'zenity',
      args:
        kind === 'file'
          ? ['--file-selection', `--title=${prompt}`, `--filename=${home}/`]
          : ['--file-selection', '--directory', `--title=${prompt}`, `--filename=${home}/`],
    },
    {
      cmd: 'kdialog',
      args:
        kind === 'file'
          ? ['--title', prompt, '--getopenfilename', home]
          : ['--title', prompt, '--getexistingdirectory', home],
    },
  ];
  for (const { cmd, args } of helpers) {
    const { stdout, stderr, err } = await run(cmd, args);
    if (err?.code === 'ENOENT') continue; // helper not installed — try the next one
    if (err) {
      // Exit code 1 is the dialog's cancel/close path for both helpers.
      if (err.code === 1) return { canceled: true };
      console.error(`[nativeChooser] ${cmd} failed:`, stderr || err.message);
      return { error: 'could not open the system dialog' };
    }
    const path = stdout.trim();
    return path ? { path } : { canceled: true };
  }
  return {
    error:
      'no dialog helper found: install zenity (or kdialog), or POST /api/cbct/source with { path } instead',
    unsupported: true,
  };
}

export function chooseNative(kind: ChooserKind, prompt: string): Promise<ChooserResult> {
  switch (process.platform) {
    case 'darwin':
      return chooseMac(kind, prompt);
    case 'win32':
      return chooseWindows(kind, prompt);
    case 'linux':
      return chooseLinux(kind, prompt);
    default:
      return Promise.resolve({
        error: 'no native dialog on this platform — POST /api/cbct/source with { path } instead',
        unsupported: true,
      });
  }
}
