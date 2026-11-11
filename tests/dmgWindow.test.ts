// The macOS disk image: its window (the picture, the icon places in electron-builder.yml, the
// volume title) and its own signature, notarisation and staple (scripts/desktop-notarize.mjs),
// read without building anything.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DMG_LAYOUT, DMG_SENTENCE, dmgBackgroundSvg, iconColours } from '../scripts/dmg-background.mjs';
import {
  dmgCommands,
  dmgNotarySkip,
  notariseDmgs,
  notaryAuth,
  showCommand,
  SKIP_NO_IDENTITY,
  SKIP_UNSIGNED,
} from '../scripts/desktop-notarize.mjs';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const yml = read('electron-builder.yml');
const dmgBlock = yml.slice(yml.indexOf('\ndmg:\n') + 1).split(/\n(?=\S)/)[0];
const num = (re: RegExp) => Number(dmgBlock.match(re)?.[1]);

/** width and height from a PNG's IHDR */
const pngSize = (p: string) => {
  const b = readFileSync(path.join(root, p));
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
};

describe('the dmg window', () => {
  const { window: w, iconSize, app, applications } = DMG_LAYOUT;

  it('electron-builder.yml repeats the layout the picture is drawn for', () => {
    expect(dmgBlock).toMatch(/^ {2}background: desktop\/icon\/dmg-background\.png$/m);
    expect(num(/^ {4}width: (\d+)$/m)).toBe(w.width);
    expect(num(/^ {4}height: (\d+)$/m)).toBe(w.height);
    expect(num(/^ {2}iconSize: (\d+)$/m)).toBe(iconSize);
    const entries = [...dmgBlock.matchAll(/- x: (\d+)\n\s+y: (\d+)\n\s+type: (\w+)/g)].map((m) => ({ x: +m[1], y: +m[2], type: m[3] }));
    expect(entries).toEqual([
      { ...app, type: 'file' },
      { ...applications, type: 'link' },
    ]);
    expect(dmgBlock).toMatch(/type: link\n\s+path: \/Applications$/m);
  });

  it('both icons sit wholly inside the window, clear of each other, with room for the label', () => {
    for (const c of [app, applications]) {
      expect(c.x - iconSize / 2).toBeGreaterThan(0);
      expect(c.x + iconSize / 2).toBeLessThan(w.width);
      expect(c.y - iconSize / 2).toBeGreaterThan(0);
      // Finder writes the name under the icon, about 20 points; the window frame may take some
      // of the bottom edge
      expect(c.y + iconSize / 2 + 20).toBeLessThan(w.height - 40);
    }
    expect(applications.x - app.x).toBeGreaterThan(iconSize * 2);
  });

  it('the committed pictures are the window at 1x and 2x', () => {
    expect(pngSize('desktop/icon/dmg-background.png')).toEqual(w);
    expect(pngSize('desktop/icon/dmg-background@2x.png')).toEqual({ width: w.width * 2, height: w.height * 2 });
  });

  it('the picture says the one sentence, in the icon colours, with no version', () => {
    const colours = iconColours(read('desktop/icon/cbctscope.svg'));
    expect(colours).toEqual({ ground: '#141518', amber: '#f0b43a' });
    const svg = dmgBackgroundSvg(colours);
    expect(DMG_SENTENCE).toBe('Drag CBCTScope to Applications');
    expect(svg).toContain(`>${DMG_SENTENCE}</text>`);
    expect(svg).not.toMatch(/\d+\.\d+\.\d+/);
    expect(svg).not.toMatch(/[\u2013\u2014]/);
  });

  it('the volume is titled with the version only; the file name keeps the architecture', () => {
    expect(dmgBlock).toMatch(/^ {2}title: \$\{productName\} \$\{version\}$/m);
    expect(dmgBlock).toMatch(/^ {2}artifactName: \$\{productName\}-\$\{version\}-\$\{arch\}\.\$\{ext\}$/m);
    expect(dmgBlock).toMatch(/^ {2}sign: true$/m);
  });

  it('the window sources stay out of the packaged app', () => {
    expect(yml).toMatch(/^ {2}- "!desktop\/icon\/\*\*"$/m);
  });
});

describe('the dmg notarisation', () => {
  const dmg = '/x/CBCTScope-2.0.0-arm64.dmg';

  it('skips off macOS and on an unsigned build, unless an identity is named', () => {
    expect(dmgNotarySkip({}, 'linux')).toMatch(/not macOS/);
    expect(dmgNotarySkip({ CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, 'darwin')).toBe(SKIP_UNSIGNED);
    expect(dmgNotarySkip({ CSC_IDENTITY_AUTO_DISCOVERY: 'false', CSC_NAME: 'Someone (TEAM)' }, 'darwin')).toBeNull();
    expect(dmgNotarySkip({}, 'darwin')).toBeNull();
  });

  it('chooses the credentials in electron-builder order', () => {
    const id = { APPLE_ID: 'a@b.c', APPLE_APP_SPECIFIC_PASSWORD: 'pw', APPLE_TEAM_ID: 'T1' };
    const api = { APPLE_API_KEY: '/k/AuthKey.p8', APPLE_API_KEY_ID: 'K1', APPLE_API_ISSUER: 'I1' };
    const profile = { APPLE_KEYCHAIN_PROFILE: 'notary' };
    expect(notaryAuth({ ...id, ...api, ...profile })).toEqual({ route: 'apple-id', args: ['--apple-id', 'a@b.c', '--password', 'pw', '--team-id', 'T1'] });
    expect(notaryAuth({ ...api, ...profile })).toEqual({ route: 'api-key', args: ['--key', '/k/AuthKey.p8', '--key-id', 'K1', '--issuer', 'I1'] });
    expect(notaryAuth(profile)).toEqual({ route: 'keychain-profile', args: ['--keychain-profile', 'notary'] });
    expect(notaryAuth({ ...profile, APPLE_KEYCHAIN: '/k/login.keychain-db' })!.args).toEqual(['--keychain', '/k/login.keychain-db', '--keychain-profile', 'notary']);
    expect(notaryAuth({})).toBeNull();
  });

  it('refuses a half set of credentials, naming what is missing', () => {
    expect(() => notaryAuth({ APPLE_ID: 'a@b.c' })).toThrow(/APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID/);
    expect(() => notaryAuth({ APPLE_API_KEY: '/k' })).toThrow(/APPLE_API_KEY_ID, APPLE_API_ISSUER/);
  });

  it('submits and waits, staples, validates; the printed form hides the password', () => {
    const cmds = dmgCommands(dmg, ['--keychain-profile', 'notary']);
    expect(cmds.map(showCommand)).toEqual([
      `xcrun notarytool submit ${dmg} --keychain-profile notary --wait --output-format json`,
      `xcrun stapler staple ${dmg}`,
      `xcrun stapler validate ${dmg}`,
    ]);
    expect(showCommand(['xcrun', ['notarytool', 'submit', dmg, '--password', 'secret']])).not.toContain('secret');
  });

  type Call = [string, string[]];
  const fake = (answers: Record<string, { status: number; stdout?: string; stderr?: string }>) => {
    const calls: Call[] = [];
    const run = (cmd: string, args: string[]) => {
      calls.push([cmd, args]);
      const key = cmd === 'codesign' ? 'codesign' : args.slice(0, 2).join(' ');
      return { stdout: '', stderr: '', ...(answers[key] ?? { status: 0 }) };
    };
    return { calls, run };
  };
  const signed = { status: 0, stderr: 'Authority=Developer ID Application: Someone (TEAM)\n' };
  const env = { APPLE_KEYCHAIN_PROFILE: 'notary' };

  it('an unsigned build logs one line and runs no notary command', () => {
    const lines: string[] = [];
    const f = fake({});
    expect(notariseDmgs([dmg, dmg.replace('arm64', 'x64')], { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, { platform: 'darwin', run: f.run, log: (l: string) => lines.push(l) })).toBe('skipped');
    expect(lines).toEqual([SKIP_UNSIGNED]);
    expect(f.calls).toEqual([]);
    const g = fake({ codesign: { status: 1, stderr: 'code object is not signed at all' } });
    const more: string[] = [];
    expect(notariseDmgs([dmg], env, { platform: 'darwin', run: g.run, log: (l: string) => more.push(l) })).toBe('skipped');
    expect(more).toEqual([SKIP_NO_IDENTITY]);
    expect(g.calls.every(([c]) => c === 'codesign')).toBe(true);
  });

  it('a signed dmg is submitted, stapled and validated in that order', () => {
    const f = fake({ codesign: signed, 'notarytool submit': { status: 0, stdout: '{"id":"abc","status":"Accepted"}' } });
    expect(notariseDmgs([dmg], env, { platform: 'darwin', run: f.run, log: () => {} })).toBe('notarised');
    expect(f.calls.slice(1).map(([, a]) => a.slice(0, 2).join(' '))).toEqual(['notarytool submit', 'stapler staple', 'stapler validate']);
  });

  it('a rejected submission or a failed staple fails the build with a plain message', () => {
    const invalid = fake({ codesign: signed, 'notarytool submit': { status: 0, stdout: '{"id":"abc","status":"Invalid"}' } });
    expect(() => notariseDmgs([dmg], env, { platform: 'darwin', run: invalid.run, log: () => {} })).toThrow(/did not accept .*status Invalid.*notarytool log abc/s);
    const staple = fake({ codesign: signed, 'notarytool submit': { status: 0, stdout: '{"id":"abc","status":"Accepted"}' }, 'stapler staple': { status: 65 } });
    expect(() => notariseDmgs([dmg], env, { platform: 'darwin', run: staple.run, log: () => {} })).toThrow(/stapling .* failed \(exit 65\)/);
    const none = fake({ codesign: signed });
    expect(() => notariseDmgs([dmg], {}, { platform: 'darwin', run: none.run, log: () => {} })).toThrow(/no credentials/);
  });

  it('desktop.mjs runs it on the dmgs it built, and the release job checks the tickets', () => {
    const desktop = read('scripts/desktop.mjs');
    expect(desktop).toContain("import { notariseDmgs } from './desktop-notarize.mjs';");
    expect(desktop).toContain('notariseDmgs(dmgs, env);');
    const release = read('.github/workflows/release.yml');
    expect(release).toContain('APPLE_API_KEY="$key" npm run desktop:build -- --mac --publish never');
    expect(release).toContain('xcrun stapler validate "$dmg"');
    for (const uses of release.match(/uses: \S+/g) ?? []) expect(uses).toMatch(/@[0-9a-f]{40}$/);
  });
});
