// The macOS disk image: its window (the picture, the icon places in electron-builder.yml, the
// volume title) and its own signature, notarisation and staple (scripts/desktop-notarize.mjs),
// read without building anything.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DMG_LAYOUT, DMG_SENTENCE, LABEL_GROUND, dmgBackgroundSvg, iconColours } from '../scripts/dmg-background.mjs';
import {
  dmgCommands,
  dmgNotarySkip,
  notariseDmgs,
  notaryAuth,
  showCommand,
  NOTARY_TIMEOUT,
  SKIP_NO_IDENTITY,
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

/** an 8-bit, non-interlaced RGB or RGBA PNG decoded to rows of [r, g, b] (node:zlib only) */
const decodePng = (p: string) => {
  const b = readFileSync(path.join(root, p));
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  const [depth, type, , , interlace] = b.subarray(24, 29);
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace !== 0) throw new Error(`${p}: unexpected PNG format`);
  const bpp = type === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let o = 8; o < b.length; ) {
    const len = b.readUInt32BE(o);
    if (b.toString('latin1', o + 4, o + 8) === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const up = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= bpp ? out[(y - 1) * stride + i - bpp] : 0;
      const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
      const pred = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][filter];
      out[y * stride + i] = (line[i] + pred) & 255;
    }
  }
  return { width, height, at: (x: number, y: number) => [0, 1, 2].map((k) => out[y * stride + x * bpp + k]) };
};

/** WCAG relative luminance and contrast ratio */
const luminance = ([r, g, b]: number[]) => {
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (l1: number, l2: number) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

describe('the dmg window', () => {
  const { window: w, iconSize, app, applications } = DMG_LAYOUT;

  it('electron-builder.yml places the icons on the picture; its window block only documents the picture size', () => {
    expect(dmgBlock).toMatch(/^ {2}background: desktop\/icon\/dmg-background\.png$/m);
    // electron-builder ignores dmg.window when a background is set: these keep the record honest
    expect(num(/^ {4}width: (\d+)$/m), 'dmg.window.width documents the picture width').toBe(w.width);
    expect(num(/^ {4}height: (\d+)$/m), 'dmg.window.height documents the picture height').toBe(w.height);
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

  it('the ground behind each file name reads 4.5:1 or better against black and against white', () => {
    // Finder draws the names black under Light and white under Dark; the picture serves both
    const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    expect(contrast(luminance(hex(LABEL_GROUND)), 0)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(luminance(hex(LABEL_GROUND)), 1)).toBeGreaterThanOrEqual(4.5);
    const margin = 6;
    for (const [file, scale] of [['desktop/icon/dmg-background.png', 1], ['desktop/icon/dmg-background@2x.png', 2]] as const) {
      const png = decodePng(file);
      for (const [name, l] of Object.entries(DMG_LAYOUT.labels)) {
        const x0 = Math.floor((l.x - l.width / 2 - margin) * scale);
        const x1 = Math.ceil((l.x + l.width / 2 + margin) * scale);
        const y0 = Math.floor((l.y - l.height / 2 - margin) * scale);
        const y1 = Math.ceil((l.y + l.height / 2 + margin) * scale);
        let worst = Infinity;
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const lum = luminance(png.at(x, y));
            worst = Math.min(worst, contrast(lum, 0), contrast(lum, 1));
          }
        expect(worst, `${file}, ${name} label`).toBeGreaterThanOrEqual(4.5);
      }
    }
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

  it('skips off macOS only; on macOS the signature of the built image decides', () => {
    expect(dmgNotarySkip('linux')).toMatch(/not macOS/);
    expect(dmgNotarySkip('darwin')).toBeNull();
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

  it('submits and waits at most 45 minutes, staples, validates; the printed form hides the password', () => {
    expect(NOTARY_TIMEOUT).toBe('45m');
    const cmds = dmgCommands(dmg, ['--keychain-profile', 'notary']);
    expect(cmds.map(showCommand)).toEqual([
      `xcrun notarytool submit ${dmg} --keychain-profile notary --wait --timeout 45m --output-format json`,
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

  it('an unsigned build logs one line and runs no notary command, whatever the environment says', () => {
    const unsigned = { status: 1, stderr: 'code object is not signed at all' };
    const lines: string[] = [];
    const f = fake({ codesign: unsigned });
    expect(notariseDmgs([dmg, dmg.replace('arm64', 'x64')], { CSC_IDENTITY_AUTO_DISCOVERY: 'false', ...env }, { platform: 'darwin', run: f.run, log: (l: string) => lines.push(l) })).toBe('skipped');
    expect(lines).toEqual([SKIP_NO_IDENTITY]);
    expect(f.calls.every(([c]) => c === 'codesign')).toBe(true);
    const g = fake({ codesign: { status: 1, stderr: 'code object is not signed at all' } });
    const more: string[] = [];
    expect(notariseDmgs([dmg], env, { platform: 'darwin', run: g.run, log: (l: string) => more.push(l) })).toBe('skipped');
    expect(more).toEqual([SKIP_NO_IDENTITY]);
    expect(g.calls.every(([c]) => c === 'codesign')).toBe(true);
  });

  it('an image signed under CSC_IDENTITY_AUTO_DISCOVERY=false is still notarised', () => {
    const f = fake({ codesign: signed, 'notarytool submit': { status: 0, stdout: '{"id":"abc","status":"Accepted"}' } });
    expect(notariseDmgs([dmg], { ...env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, { platform: 'darwin', run: f.run, log: () => {} })).toBe('notarised');
  });

  it('a notary queue that does not answer in time fails with a message that says a rerun is safe', () => {
    const slow = fake({ codesign: signed, 'notarytool submit': { status: 1, stdout: '{"id":"abc","status":"In Progress"}', stderr: 'Timeout of 45m reached' } });
    expect(() => notariseDmgs([dmg], env, { platform: 'darwin', run: slow.run, log: () => {} })).toThrow(/did not answer .* within 45m.*rerunning the job is safe/s);
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
    expect(release).toMatch(/^ {2}desktop-mac:\n(?: {4}.*\n)*? {4}timeout-minutes: 90$/m);
    expect(release).toContain('umask 077');
    // the site goes live only once the installers are attached
    expect(release).toContain("  deploy:\n    needs: [build, publish]\n    if: ${{ !cancelled() && needs.build.result == 'success' && needs.publish.result == 'success' }}\n");
    for (const uses of release.match(/uses: \S+/g) ?? []) expect(uses).toMatch(/@[0-9a-f]{40}$/);
  });
});
