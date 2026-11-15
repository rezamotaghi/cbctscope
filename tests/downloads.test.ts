// The header's download menu (components/downloads.ts) and the release job that makes its links
// work: the fixed installer names, the link addresses, the per-system order, release.yml
// attaching byte copies under exactly those names after signing, notarisation and stapling, and
// the guard of scripts/release-assets.mjs in its two modes (the release, the site update).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTALLER_NAMES, MAC_NOTE, downloadEntries, downloadSystem, installerUrl } from '../components/downloads';
import { RELEASES_URL } from '../components/links';
import { REQUIRED_ASSETS, checkSiteUpdate, latestProblem, missingAssets, nextPage, siteUpdateMissingLines, siteUpdateProblem, tagFor } from '../scripts/release-assets.mjs';

const root = path.resolve(__dirname, '..');
const workflowText = readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');

// js-yaml is not a dependency of this repo: it is read from electron-builder's own tree, so the
// workflow is parsed as YAML without adding a package
const rootRequire = createRequire(path.join(root, 'package.json'));
const yaml = createRequire(rootRequire.resolve('electron-builder'))('js-yaml') as { load: (s: string) => unknown };

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
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
      deploy: null,
      'desktop-gate': null,
      'desktop-mac': { contents: 'read' },
      'desktop-win': { contents: 'read' },
      publish: { contents: 'write' },
    });
  });
});

describe('the deploy job ships the site only when the release carries the three installers', () => {
  const deploySteps = workflow.jobs.deploy.steps ?? [];
  const at = (name: string) => deploySteps.findIndex((s) => s.name === name);
  const GUARD = 'Check the release carries the installers';

  it('the guard checks exactly the fixed names of components/downloads.ts', () => {
    expect([...REQUIRED_ASSETS].sort()).toEqual(Object.values(INSTALLER_NAMES).sort());
  });

  it('a release lacking any of them, or holding one still uploading, is refused, naming each missing file', () => {
    const all = Object.values(INSTALLER_NAMES).map((name) => ({ name, state: 'uploaded' }));
    const versioned = [{ name: 'CBCTScope-0.9.0-arm64.dmg', state: 'uploaded' }, { name: 'CBCTScope-0.9.0-setup.exe', state: 'uploaded' }];
    expect(missingAssets([...versioned, ...all])).toEqual([]);
    expect(missingAssets([...versioned, { name: INSTALLER_NAMES.windowsSetup, state: 'uploaded' }])).toEqual([INSTALLER_NAMES.macArm64, INSTALLER_NAMES.macX64]);
    expect(missingAssets([])).toEqual([...REQUIRED_ASSETS]);
    expect(missingAssets(all.map((a) => (a.name === INSTALLER_NAMES.macX64 ? { ...a, state: 'open' } : a)))).toEqual([INSTALLER_NAMES.macX64]);
    // a name that differs in case or carries a version is not the fixed name
    expect(
      missingAssets([
        { name: 'cbctscope-mac-arm64.dmg', state: 'uploaded' },
        { name: INSTALLER_NAMES.macX64, state: 'uploaded' },
        { name: INSTALLER_NAMES.windowsSetup, state: 'uploaded' },
      ]),
    ).toEqual([INSTALLER_NAMES.macArm64]);
    // an asset without a state is not taken for a finished upload
    expect(missingAssets([{ name: INSTALLER_NAMES.macArm64 }, ...all.filter((a) => a.name !== INSTALLER_NAMES.macArm64)])).toEqual([INSTALLER_NAMES.macArm64]);
  });

  it('passes only the release that GitHub serves as latest, where the menu links lead', () => {
    expect(latestProblem(200, 426490848, '426490848')).toBeNull();
    expect(latestProblem(200, 111, '222')).toMatch(/release 222 is not GitHub's latest release \(that is 111\).*publish it as the latest release, not as a prerelease/);
    expect(latestProblem(404, null, '222')).toMatch(/no latest release.*publish it as the latest release, not as a prerelease/);
    expect(latestProblem(500, null, '222')).toBe('release-assets: GitHub answered 500 for the latest release');
    expect(latestProblem(403, null, '222')).toMatch(/answered 403/);
  });

  it('follows the next page of a Link header and stops on the last', () => {
    const next = 'https://api.github.com/repositories/1/releases/2/assets?per_page=100&page=2';
    expect(nextPage(`<${next}>; rel="next", <https://api.github.com/repositories/1/releases/2/assets?per_page=100&page=3>; rel="last"`)).toBe(next);
    expect(nextPage('<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=1>; rel="first"')).toBeNull();
    expect(nextPage(null)).toBeNull();
    expect(nextPage('')).toBeNull();
  });

  it('the guard runs in the deploy job before anything is uploaded to Vercel, on the release of the event', () => {
    const guard = at(GUARD);
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(at('Install the Vercel CLI'));
    expect(guard).toBeLessThan(at('Lay out the prebuilt deployment'));
    expect(guard).toBeLessThan(at('Deploy to production'));
    expect(deploySteps[guard].run).toBe('node scripts/release-assets.mjs');
    expect(deploySteps[guard].env).toEqual({ RELEASE_ID: '${{ github.event.release.id }}', GITHUB_TOKEN: '${{ github.token }}' });
  });

  it('the rehearsal, which has no release, does not run it', () => {
    expect(readFileSync(path.join(root, '.github/workflows/site-rehearsal.yml'), 'utf8')).not.toMatch(/release-assets/);
  });
});

describe('a site update ships only when the latest release is the version the site carries', () => {
  const API = 'https://api.github.test';
  const REPO = 'owner/repo';
  const all = Object.values(INSTALLER_NAMES).map((name) => ({ name, state: 'uploaded' }));

  /** a fetch that answers from a table of url to [status, body], and throws for any other url */
  const fakeFetch = (table: Record<string, [number, unknown] | Error>) =>
    (async (url: string | URL | Request) => {
      const answer = table[String(url)];
      if (!answer) throw new Error(`unexpected request ${String(url)}`);
      if (answer instanceof Error) throw answer;
      const [status, body] = answer;
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
  const LATEST = `${API}/repos/${REPO}/releases/latest`;
  const ASSETS = `${API}/repos/${REPO}/releases/77/assets?per_page=100`;
  const check = (table: Record<string, [number, unknown] | Error>, version = '2.1.1') =>
    checkSiteUpdate({ api: API, repository: REPO, token: '', version, fetchImpl: fakeFetch(table) });

  it('the tag is v and the version', () => {
    expect(tagFor('2.1.1')).toBe('v2.1.1');
  });

  it('passes when the latest release has the tag of the version, and refuses another tag, no latest release, or another answer', () => {
    expect(siteUpdateProblem(200, 'v2.1.1', '2.1.1')).toBeNull();
    expect(siteUpdateProblem(200, 'v2.1.0', '2.1.1')).toBe(
      "release-assets: the latest release is v2.1.0, but package.json on this commit says 2.1.1, so the site would name a version whose installers are not published; publish v2.1.1 as a release instead (it deploys the site), or run the site update from a commit whose version is the latest release's",
    );
    // a tag without the v, or a release whose answer carries no tag, is not the version's tag
    expect(siteUpdateProblem(200, '2.1.1', '2.1.1')).toMatch(/the latest release is 2\.1\.1, but package\.json/);
    expect(siteUpdateProblem(200, null, '2.1.1')).toMatch(/the latest release is null/);
    expect(siteUpdateProblem(404, null, '2.1.1')).toMatch(/no latest release.*publish v2\.1\.1 as the latest release with the release workflow/);
    expect(siteUpdateProblem(500, null, '2.1.1')).toBe('release-assets: GitHub answered 500 for the latest release; run the site update again later');
    expect(siteUpdateProblem(403, null, '2.1.1')).toMatch(/answered 403.*run the site update again/);
  });

  it('names each installer the latest release lacks, and says to attach it and run again', () => {
    expect(siteUpdateMissingLines([], 'v2.1.1')).toEqual([]);
    expect(siteUpdateMissingLines([INSTALLER_NAMES.macX64], 'v2.1.1')).toEqual([
      'release-assets: release v2.1.1 lacks 1 of the 3 installers the download menu links to, so the site is not deployed:',
      `  ${INSTALLER_NAMES.macX64}`,
      'release-assets: attach them to release v2.1.1, then run the site update again',
    ]);
  });

  it('reads the latest release, then that release\'s assets: tag equal and all three installers pass', async () => {
    expect(await check({ [LATEST]: [200, { id: 77, tag_name: 'v2.1.1' }], [ASSETS]: [200, all] })).toEqual([]);
  });

  it('a different tag refuses before the assets are read', async () => {
    const lines = await check({ [LATEST]: [200, { id: 77, tag_name: 'v2.1.0' }] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/the latest release is v2\.1\.0, but package\.json on this commit says 2\.1\.1/);
  });

  it('no latest release refuses', async () => {
    expect(await check({ [LATEST]: [404, { message: 'Not Found' }] })).toEqual([siteUpdateProblem(404, null, '2.1.1')]);
  });

  it('missing installers refuse, naming each', async () => {
    const lines = await check({ [LATEST]: [200, { id: 77, tag_name: 'v2.1.1' }], [ASSETS]: [200, all.filter((a) => a.name !== INSTALLER_NAMES.windowsSetup)] });
    expect(lines).toEqual(siteUpdateMissingLines([INSTALLER_NAMES.windowsSetup], 'v2.1.1'));
  });

  it('fails closed: a network error, a non-200 answer, or a version that is not major.minor.patch', async () => {
    await expect(check({ [LATEST]: new TypeError('fetch failed') })).rejects.toThrow(/could not read the latest release.*fetch failed/);
    await expect(check({ [LATEST]: [200, { id: 77, tag_name: 'v2.1.1' }], [ASSETS]: new TypeError('fetch failed') })).rejects.toThrow(/could not read the release's assets/);
    await expect(check({ [LATEST]: [200, { id: 77, tag_name: 'v2.1.1' }], [ASSETS]: [502, {}] })).rejects.toThrow(/GitHub answered 502/);
    await expect(check({ [LATEST]: [200, { tag_name: 'v2.1.1' }] })).rejects.toThrow(/carries no release id/);
    expect(await check({ [LATEST]: [503, {}] })).toEqual([siteUpdateProblem(503, null, '2.1.1')]);
    expect(await check({}, '2.1.1-beta')).toEqual(['release-assets: package.json\'s version "2.1.1-beta" is not major.minor.patch; set a release version there']);
  });
});
