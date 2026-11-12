// The header's download menu (components/downloads.ts) and the release job that makes its links
// work: the fixed installer names, the link addresses, the per-system order, and release.yml
// attaching byte copies under exactly those names after signing, notarisation and stapling.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTALLER_NAMES, MAC_NOTE, downloadEntries, downloadSystem, installerUrl } from '../components/downloads';
import { RELEASES_URL } from '../components/links';

const root = path.resolve(__dirname, '..');
const workflowText = readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');

// js-yaml is not a dependency of this repo: it is read from electron-builder's own tree, so the
// workflow is parsed as YAML without adding a package
const rootRequire = createRequire(path.join(root, 'package.json'));
const yaml = createRequire(rootRequire.resolve('electron-builder'))('js-yaml') as { load: (s: string) => unknown };

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
type Job = { needs?: string | string[]; permissions?: Record<string, string>; steps?: Step[] };
const workflow = yaml.load(workflowText) as { permissions: Record<string, string>; jobs: Record<string, Job> };

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const ARM = 'https://github.com/rezamotaghi/cbctscope/releases/latest/download/CBCTScope-mac-arm64.dmg';
const X64 = 'https://github.com/rezamotaghi/cbctscope/releases/latest/download/CBCTScope-mac-x64.dmg';
const WIN = 'https://github.com/rezamotaghi/cbctscope/releases/latest/download/CBCTScope-windows-setup.exe';
const ALL = 'https://github.com/rezamotaghi/cbctscope/releases/latest';

/** the menu as [label or note, address] rows */
const rows = (ua: string) => downloadEntries(ua).map((e) => (e.kind === 'note' ? ['note', e.text] : [e.label, e.href]));

describe('the download links', () => {
  it('the fixed names carry no version and are the three installers', () => {
    expect(INSTALLER_NAMES).toEqual({
      macArm64: 'CBCTScope-mac-arm64.dmg',
      macX64: 'CBCTScope-mac-x64.dmg',
      windowsSetup: 'CBCTScope-windows-setup.exe',
    });
    for (const name of Object.values(INSTALLER_NAMES)) expect(name).not.toMatch(/\d+\.\d+/);
  });

  it('each link is the latest release download of its fixed name', () => {
    expect(RELEASES_URL).toBe(ALL);
    expect(installerUrl(INSTALLER_NAMES.macArm64)).toBe(ARM);
    expect(installerUrl(INSTALLER_NAMES.macX64)).toBe(X64);
    expect(installerUrl(INSTALLER_NAMES.windowsSetup)).toBe(WIN);
  });

  it('the visitor system comes from the user agent, a phone being neither', () => {
    expect(downloadSystem(MAC_UA)).toBe('mac');
    expect(downloadSystem(WIN_UA)).toBe('windows');
    expect(downloadSystem(LINUX_UA)).toBe('other');
    expect(downloadSystem(IPHONE_UA)).toBe('other');
    expect(downloadSystem('')).toBe('other');
  });

  it('macOS and every other system list the Macs first; Windows lists Windows first; all five lines always', () => {
    const macFirst = [
      ['Mac with Apple silicon', ARM],
      ['Mac with Intel', X64],
      ['Windows', WIN],
      ['note', MAC_NOTE],
      ['All downloads and release notes', ALL],
    ];
    expect(rows(MAC_UA)).toEqual(macFirst);
    expect(rows(LINUX_UA)).toEqual(macFirst);
    expect(rows('')).toEqual(macFirst);
    expect(rows(WIN_UA)).toEqual([
      ['Windows', WIN],
      ['Mac with Apple silicon', ARM],
      ['Mac with Intel', X64],
      ['note', MAC_NOTE],
      ['All downloads and release notes', ALL],
    ]);
    expect(MAC_NOTE).toBe('Which Mac? Apple menu, About This Mac. Chip: Apple M1 or later is Apple silicon. Processor: Intel is Intel.');
  });
});

describe('release.yml attaches the installers under the fixed names', () => {
  const steps = (job: string) => workflow.jobs[job].steps ?? [];
  const at = (job: string, name: string) => steps(job).findIndex((s) => s.name === name);
  const uploadAt = (job: string) => steps(job).findIndex((s) => s.uses?.startsWith('actions/upload-artifact@'));

  it('the workflow names exactly the three fixed names, no other', () => {
    const named = new Set(workflowText.match(/CBCTScope-(?:mac|windows)-[\w-]+\.(?:dmg|exe)/g));
    expect(named).toEqual(new Set(Object.values(INSTALLER_NAMES)));
  });

  it('the mac job copies each stapled dmg after notarisation and its check, validates the copies, then uploads them', () => {
    const copy = at('desktop-mac', 'Copy the dmgs to their fixed names');
    expect(copy).toBeGreaterThan(at('desktop-mac', 'Package, sign and notarise'));
    expect(copy).toBeGreaterThan(at('desktop-mac', 'Check the dmg tickets'));
    expect(copy).toBeLessThan(uploadAt('desktop-mac'));
    const run = steps('desktop-mac')[copy].run ?? '';
    expect(run).toContain(`copy "dist-desktop/CBCTScope-\${version}-arm64.dmg" "dist-desktop/${INSTALLER_NAMES.macArm64}"`);
    expect(run).toContain(`copy "dist-desktop/CBCTScope-\${version}-x64.dmg" "dist-desktop/${INSTALLER_NAMES.macX64}"`);
    expect(run).toContain('cp "$1" "$2"');
    expect(run).toContain('cmp "$1" "$2"');
    expect(run).toContain('xcrun stapler validate "$2"');
    expect(run).toContain('spctl --assess --type open --context context:primary-signature -v "$2"');
    // a copy, never a second build
    expect(run).not.toMatch(/desktop:build|electron-builder|notarytool|stapler staple/);
    expect(String(steps('desktop-mac')[uploadAt('desktop-mac')].with?.path)).toContain('dist-desktop/*.dmg');
  });

  it('the Windows job copies the installer after packaging and uploads it', () => {
    const copy = at('desktop-win', 'Copy the installer to its fixed name');
    expect(copy).toBeGreaterThan(at('desktop-win', 'Package (unsigned)'));
    expect(copy).toBeLessThan(uploadAt('desktop-win'));
    const run = steps('desktop-win')[copy].run ?? '';
    expect(run).toContain(`cp "dist-desktop/CBCTScope-\${version}-setup.exe" "dist-desktop/${INSTALLER_NAMES.windowsSetup}"`);
    expect(run).toContain(`cmp "dist-desktop/CBCTScope-\${version}-setup.exe" "dist-desktop/${INSTALLER_NAMES.windowsSetup}"`);
    expect(run).not.toMatch(/desktop:build|electron-builder/);
    expect(steps('desktop-win')[uploadAt('desktop-win')].with?.path).toBe('dist-desktop/*.exe');
  });

  it('the copies keep the versioned files: electron-builder still names them with the version', () => {
    const builder = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
    expect(builder).toContain('  artifactName: ${productName}-${version}-${arch}.${ext}');
    expect(builder).toContain('  artifactName: ${productName}-${version}-setup.${ext}');
  });

  it('the publish job attaches everything downloaded, and the job graph and permissions are as before', () => {
    expect(steps('publish').map((s) => s.run).filter(Boolean)).toEqual(['gh release upload "$TAG" packages/* --clobber --repo "$GITHUB_REPOSITORY"']);
    const graph = Object.fromEntries(
      Object.entries(workflow.jobs).map(([name, job]) => [name, ([] as string[]).concat(job.needs ?? [])]),
    );
    expect(graph).toEqual({
      test: [],
      build: ['test'],
      deploy: ['build', 'publish'],
      'desktop-gate': ['test'],
      'desktop-mac': ['test', 'desktop-gate'],
      'desktop-win': ['test'],
      publish: ['desktop-mac', 'desktop-win'],
    });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const perms = Object.fromEntries(Object.entries(workflow.jobs).map(([name, job]) => [name, job.permissions ?? null]));
    expect(perms).toEqual({
      test: null,
      build: null,
      deploy: { pages: 'write', 'id-token': 'write' },
      'desktop-gate': null,
      'desktop-mac': { contents: 'read' },
      'desktop-win': { contents: 'read' },
      publish: { contents: 'write' },
    });
  });
});
