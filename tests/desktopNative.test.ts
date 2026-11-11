// The desktop app's native surfaces (desktop/native.mjs), read without a display: the
// remote-debugging refusal, the user-agent token, the About panel, the save panel title, the
// menu bar's labels, and the packaging settings that keep the Info.plist free of device use.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aboutPanelOptions,
  APP_NAME,
  debugSwitchIn,
  desktopUserAgent,
  MANUAL_EVENT,
  menuTemplate,
  MIN_WINDOW,
  PORT_IN_USE,
  PROFILE_FOLDER,
  saveDialogTitle,
  WINDOW_STATE_FILE,
  windowBoundsFor,
  windowStateToSave,
} from '../desktop/native.mjs';
import { FORBIDDEN_USAGE } from '../scripts/desktop-after-pack.mjs';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json')) as { name: string; productName: string; version: string };

type Item = { label?: string; role?: string; type?: string; submenu?: Item[] };
const noop = () => {};
const template = (isMac: boolean) => menuTemplate({ isMac, openFolder: noop, openManual: noop, openWebsite: noop }) as Item[];
const menu = (items: Item[], name: string) => items.find((m) => m.label === name || m.role === name.toLowerCase());

describe('the remote-debugging refusal', () => {
  const bin = '/Applications/CBCTScope.app/Contents/MacOS/CBCTScope';
  it('finds either switch in every form Chromium reads', () => {
    expect(debugSwitchIn([bin, '--remote-debugging-port=9334'], 'darwin')).toBe('remote-debugging-port');
    expect(debugSwitchIn([bin, '--remote-debugging-port', '9334'], 'darwin')).toBe('remote-debugging-port');
    expect(debugSwitchIn([bin, '-remote-debugging-port=0'], 'darwin')).toBe('remote-debugging-port');
    expect(debugSwitchIn([bin, '--remote-debugging-pipe'], 'linux')).toBe('remote-debugging-pipe');
    expect(debugSwitchIn(['CBCTScope.exe', '/Remote-Debugging-Port=9334'], 'win32')).toBe('remote-debugging-port');
    expect(debugSwitchIn([bin, '--', '--remote-debugging-port=1'], 'darwin')).toBe('remote-debugging-port');
  });
  it('lets every other launch through', () => {
    expect(debugSwitchIn([bin], 'darwin')).toBeNull();
    expect(debugSwitchIn([bin, '--user-data-dir=/tmp/x', '-psn_0_12345'], 'darwin')).toBeNull();
    expect(debugSwitchIn([bin, '/remote-debugging-port=9334'], 'darwin')).toBeNull();
    // the binary's own path is never read as a switch
    expect(debugSwitchIn(['--remote-debugging-port=1'], 'darwin')).toBeNull();
  });
});

describe('the name', () => {
  it('package.json names the app CBCTScope and the profile keeps its folder', () => {
    expect(pkg.productName).toBe(APP_NAME);
    expect(read('electron-builder.yml')).toMatch(/^productName: CBCTScope$/m);
    // the folder Electron used before productName existed: package.json name
    expect(PROFILE_FOLDER).toBe(pkg.name);
  });
  it('the user agent carries the token shell.ts matches, exactly once', () => {
    expect(read('components/cbct/shell.ts')).toContain("navigator.userAgent.includes('CBCTScope/')");
    const plain = 'Mozilla/5.0 (Macintosh) Chrome/140.0 Electron/45.2.2 Safari/537.36';
    expect(desktopUserAgent(plain, '2.0.0')).toBe(`${plain} CBCTScope/2.0.0`);
    const named = 'Mozilla/5.0 (Macintosh) CBCTScope/2.0.0 Chrome/140.0 Electron/45.2.2 Safari/537.36';
    expect(desktopUserAgent(named, '2.0.0')).toBe(named);
    expect(desktopUserAgent(plain.replace('Chrome', 'cbctscope/2.0.0 Chrome'), '2.0.0').match(/CBCTScope\//g)).toHaveLength(1);
  });
});

describe('the menu bar', () => {
  it('macOS: app menu, File with Open…, Edit, View without reload, Window, Help with the manual first', () => {
    const t = template(true);
    expect(t.map((m) => m.label ?? m.role)).toEqual(['appMenu', 'File', 'editMenu', 'View', 'windowMenu', 'help']);
    expect(menu(t, 'File')!.submenu![0]).toMatchObject({ label: 'Open…', accelerator: 'CmdOrCtrl+O' });
    expect(menu(t, 'File')!.submenu!.map((i) => i.role ?? i.type ?? i.label)).toEqual(['Open…', 'separator', 'close']);
    expect(menu(t, 'View')!.submenu!.map((i) => i.role ?? i.type)).toEqual(['resetZoom', 'zoomIn', 'zoomOut', 'separator', 'togglefullscreen']);
    expect(menu(t, 'Help')!.submenu!.map((i) => i.label)).toEqual(['CBCTScope Help', 'CBCTScope Website']);
  });
  it('Windows: no app menu, Exit in File, About at the end of Help', () => {
    const t = template(false);
    expect(t.map((m) => m.label ?? m.role)).toEqual(['File', 'editMenu', 'View', 'windowMenu', 'help']);
    expect(menu(t, 'File')!.submenu!.at(-1)).toEqual({ role: 'quit' });
    const help = menu(t, 'Help')!.submenu!;
    expect(help[0].label).toBe('CBCTScope Help');
    expect(help.at(-1)).toEqual({ role: 'about' });
  });
  it('the ellipsis is the single character, and no label carries a dash or a glyph', () => {
    const labels = JSON.stringify(template(true)) + JSON.stringify(template(false));
    expect(labels).not.toContain('...');
    expect(labels).not.toMatch(/[\u2013\u2014\u{1F300}-\u{1FAFF}]/u);
  });
  it('Help opens the drawer through the event the page listens for', () => {
    expect(read('components/cbct/ManualDrawer.tsx')).toContain(`export const MANUAL_EVENT = '${MANUAL_EVENT}';`);
  });
});

describe('About, the save panel, the port dialogue', () => {
  it('About reads the version once, the copyright, the research line and the website', () => {
    const a = aboutPanelOptions(pkg.version);
    expect(a).toMatchObject({ applicationName: 'CBCTScope', applicationVersion: '2.0.0', version: '', copyright: '© 2026 Reza Motaghi' });
    expect(a.credits).toBe('Research software. Not a medical device.\nhttps://cbctscope.com');
  });
  it('the save panel is titled for what it saves', () => {
    expect(saveDialogTitle('demo_ab12-snap-2026.png')).toBe('Save snapshot');
    expect(saveDialogTitle('demo_ab12_ceph_bone.PNG')).toBe('Save snapshot');
    expect(saveDialogTitle('demo_ab12_slices.zip')).toBe('Save export');
    expect(saveDialogTitle('demo_ab12_300hu.stl')).toBe('Save export');
    expect(saveDialogTitle('demo_ab12.nii.gz')).toBe('Save export');
  });
  it('the port dialogue names the likely case in plain words', () => {
    expect(PORT_IN_USE.message.length).toBeLessThan(70);
    expect(PORT_IN_USE.detail).toMatch(/terminal/);
    expect(PORT_IN_USE.detail).not.toMatch(/dev server|EADDRINUSE/);
  });
});

describe('the Info.plist settings', () => {
  it('extendInfo removes every device usage string the hook checks for', () => {
    const yml = read('electron-builder.yml');
    for (const key of FORBIDDEN_USAGE) expect(yml).toMatch(new RegExp(`^\\s+${key}: null$`, 'm'));
    expect(yml).toMatch(/^afterPack: \.\/scripts\/desktop-after-pack\.mjs$/m);
  });
});

describe("the window's remembered place", () => {
  const laptop = { x: 0, y: 25, width: 1512, height: 919 };
  const right = { x: 1512, y: 0, width: 2560, height: 1415 };
  it('the minimum is 1024 by 700, and main.mjs uses it', () => {
    expect(MIN_WINDOW).toEqual({ width: 1024, height: 700 });
    const main = read('desktop/main.mjs');
    expect(main).toContain('minWidth: MIN_WINDOW.width');
    expect(main).toContain('minHeight: MIN_WINDOW.height');
  });
  it('a first launch or a damaged file opens the default size, centred, within the display', () => {
    expect(windowBoundsFor(null, [right])).toEqual({ width: 1440, height: 900, maximized: false });
    expect(windowBoundsFor('garbage', [laptop])).toEqual({ width: 1440, height: 900, maximized: false });
    expect(windowBoundsFor({ x: 'a', y: 1, width: 2, height: 3 }, [laptop])).toEqual({ width: 1440, height: 900, maximized: false });
    // a small display: the default shrinks to it, never under the minimum
    expect(windowBoundsFor(null, [{ x: 0, y: 0, width: 1280, height: 777 }])).toEqual({ width: 1280, height: 777, maximized: false });
    expect(windowBoundsFor(null, [{ x: 0, y: 0, width: 800, height: 600 }])).toEqual({ width: 1024, height: 700, maximized: false });
  });
  it('a saved window comes back where it was, maximized or not', () => {
    const saved = windowStateToSave({ x: 1700, y: 120, width: 1600, height: 1000 }, true);
    expect(windowBoundsFor(saved, [laptop, right])).toEqual({ x: 1700, y: 120, width: 1600, height: 1000, maximized: true });
  });
  it('a window on a display that is gone opens centred; one partly off a display is pulled back on', () => {
    expect(windowBoundsFor({ x: 1700, y: 120, width: 1600, height: 1000, maximized: false }, [laptop])).toEqual({
      width: 1440,
      height: 900,
      maximized: false,
    });
    expect(windowBoundsFor({ x: 1200, y: 100, width: 1200, height: 800 }, [laptop])).toEqual({ x: 312, y: 100, width: 1200, height: 800, maximized: false });
  });
  it('a saved size below the minimum or above the display is clamped', () => {
    expect(windowBoundsFor({ x: 10, y: 30, width: 500, height: 300 }, [laptop])).toMatchObject({ width: 1024, height: 700 });
    expect(windowBoundsFor({ x: 10, y: 30, width: 5000, height: 3000 }, [laptop])).toMatchObject({ x: 0, y: 25, width: 1512, height: 919 });
  });
  it('the file holds numbers and a flag, nothing else', () => {
    const saved = windowStateToSave({ x: 10.4, y: 20.6, width: 1300.2, height: 800.9 }, false);
    expect(saved).toEqual({ x: 10, y: 21, width: 1300, height: 801, maximized: false });
    expect(Object.keys(saved).sort()).toEqual(['height', 'maximized', 'width', 'x', 'y']);
    expect(WINDOW_STATE_FILE).toBe('window-state.json');
  });
});
