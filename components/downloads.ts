// The header's download menu (docs/web-build.md, sections 7 and 9; manual section 2.5): direct
// links to the desktop app's installers, plain links the reader clicks, never requests the page
// makes. GitHub serves /releases/latest/download/<name> for an asset whose name is the same in
// every release, so release.yml attaches each installer a second time under the fixed names
// below, byte copies of the versioned files made after signing and notarisation.
// tests/downloads.test.ts keeps release.yml on these exact names.
import { RELEASES_URL } from './links';

/** the installers' fixed asset names, the same in every release */
export const INSTALLER_NAMES = {
  macArm64: 'CBCTScope-mac-arm64.dmg',
  macX64: 'CBCTScope-mac-x64.dmg',
  windowsSetup: 'CBCTScope-windows-setup.exe',
} as const;

/** the latest release's copy of an installer, by its fixed name */
export const installerUrl = (name: string): string => `${RELEASES_URL}/download/${name}`;

export const MAC_NOTE =
  'Which Mac? Apple menu, About This Mac. Chip: Apple M1 or later is Apple silicon. Processor: Intel is Intel.';

export type DownloadEntry =
  | { kind: 'link'; label: string; href: string; title: string }
  | { kind: 'note'; text: string };

export type DownloadSystem = 'mac' | 'windows' | 'other';

/** the visitor's system, from the user agent; the Mac's chip is never guessed */
export function downloadSystem(userAgent: string): DownloadSystem {
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(userAgent) && !/iPhone|iPad|iPod/i.test(userAgent)) return 'mac';
  return 'other';
}

/**
 * The menu's lines, every one always present: the visitor's own system first (Mac entries on
 * macOS, Windows on Windows, the Mac entries first otherwise), then the note on telling the
 * Macs apart, then the release page with every file and the release notes.
 */
export function downloadEntries(userAgent: string): DownloadEntry[] {
  const mac: DownloadEntry[] = [
    {
      kind: 'link',
      label: 'Mac with Apple silicon',
      href: installerUrl(INSTALLER_NAMES.macArm64),
      title: 'the disk image for a Mac with an Apple M chip, signed and notarised',
    },
    {
      kind: 'link',
      label: 'Mac with Intel',
      href: installerUrl(INSTALLER_NAMES.macX64),
      title: 'the disk image for a Mac with an Intel processor, signed and notarised',
    },
  ];
  const windows: DownloadEntry[] = [
    {
      kind: 'link',
      label: 'Windows',
      href: installerUrl(INSTALLER_NAMES.windowsSetup),
      title: 'the installer for Windows, for the current user',
    },
  ];
  const systems = downloadSystem(userAgent) === 'windows' ? [...windows, ...mac] : [...mac, ...windows];
  return [
    ...systems,
    { kind: 'note', text: MAC_NOTE },
    {
      kind: 'link',
      label: 'All downloads and release notes',
      href: RELEASES_URL,
      title: 'the latest release on GitHub: every file, the portable Windows build, and what changed',
    },
  ];
}
