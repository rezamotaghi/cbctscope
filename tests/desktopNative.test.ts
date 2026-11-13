// The desktop app's native surfaces (desktop/native.mjs), read without a display: the
// remote-debugging refusal, the user-agent token, the About panel, the save panel title, the
// menu bar's labels, and the packaging settings that keep the Info.plist free of device use.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  aboutPanelOptions,
  APP_NAME,
  AUTHOR_SITE,
  CITE_EVENT,
  clickScript,
  debugSwitchIn,
  desktopUserAgent,
  eventScript,
  FILE_INPUT,
  FOLDER_INPUT,
  LEGAL_PAGE,
  MANUAL_EVENT,
  menuTemplate,
  MIN_WINDOW,
  PORT_IN_USE,
  PROFILE_FOLDER,
  saveDialogTitle,
  SHORTCUTS_PAGE,
  SNAPSHOT_BUTTON,
  UPDATE_PAGE,
  updateUrl,
  WINDOW_STATE_FILE,
  windowBoundsFor,
  windowStateToSave,
  WEBSITE,
} from '../desktop/native.mjs';
import { AUTHOR_URL, SITE_URL } from '../components/siteAddress.mjs';
import { CITE_EVENT as PAGE_CITE_EVENT, menuDrawerPage } from '../components/cbct/ManualDrawer';
import { updatePageUrl } from '../components/updateCheck';
import { FORBIDDEN_USAGE } from '../scripts/desktop-after-pack.mjs';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json')) as { name: string; productName: string; version: string };

type Item = { label?: string; role?: string; type?: string; accelerator?: string; click?: () => void; submenu?: Item[] };
const noop = () => {};
const hooks = {
  openFolder: noop,
  openFile: noop,
  saveSnapshot: noop,
  openManual: noop,
  openShortcuts: noop,
  openCite: noop,
  openLegal: noop,
  openWebsite: noop,
  checkForUpdates: noop,
};
const template = (isMac: boolean) => menuTemplate({ isMac, ...hooks }) as Item[];
/** a submenu as its labels, roles and separators */
const names = (items: Item[]) => items.map((i) => i.label ?? i.role ?? i.type);
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
  const FILE = ['Open DICOMDIR or DICOM Folder…', 'Open a Single DICOM File…', 'separator', 'Save Snapshot…', 'separator'];
  const HELP = ['CBCTScope Help', 'Keyboard and Mouse Reference', 'separator', 'Cite CBCTScope', 'Legal Notice', 'separator', 'CBCTScope Website'];
  it('macOS: the app menu with Check for Updates after About, File with both openers and Save Snapshot, Edit, View without reload, Window, Help', () => {
    const t = template(true);
    expect(t.map((m) => m.label ?? m.role)).toEqual(['CBCTScope', 'File', 'editMenu', 'View', 'windowMenu', 'help']);
    expect(names(t[0].submenu!)).toEqual([
      'about',
      'separator',
      'Check for Updates…',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ]);
    expect(names(menu(t, 'File')!.submenu!)).toEqual([...FILE, 'close']);
    expect(names(menu(t, 'View')!.submenu!)).toEqual(['resetZoom', 'zoomIn', 'zoomOut', 'separator', 'togglefullscreen']);
    expect(names(menu(t, 'Help')!.submenu!)).toEqual(HELP);
  });
  it('Windows: no app menu, Exit in File, Check for Updates then About at the end of Help', () => {
    const t = template(false);
    expect(t.map((m) => m.label ?? m.role)).toEqual(['File', 'editMenu', 'View', 'windowMenu', 'help']);
    expect(names(menu(t, 'File')!.submenu!)).toEqual([...FILE, 'quit']);
    expect(menu(t, 'File')!.submenu!.at(-1)).toEqual({ role: 'quit' });
    const help = menu(t, 'Help')!.submenu!;
    expect(names(help)).toEqual([...HELP, 'Check for Updates…', 'separator', 'about']);
    expect(help.at(-1)).toEqual({ role: 'about' });
  });
  it('the accelerators: Cmd or Ctrl with O for the folder, Shift-O for one file, S for the snapshot; never a bare key', () => {
    for (const isMac of [true, false]) {
      const items = template(isMac).flatMap((m) => m.submenu ?? []);
      const keys = Object.fromEntries(items.filter((i) => i.accelerator).map((i) => [i.label, i.accelerator]));
      expect(keys).toEqual({
        'Open DICOMDIR or DICOM Folder…': 'CmdOrCtrl+O',
        'Open a Single DICOM File…': 'CmdOrCtrl+Shift+O',
        'Save Snapshot…': 'CmdOrCtrl+S',
      });
      for (const k of Object.values(keys)) expect(k).toMatch(/^CmdOrCtrl\+/);
    }
  });
  it('each item calls its own hook', () => {
    const called: string[] = [];
    const spy = Object.fromEntries(Object.keys(hooks).map((k) => [k, () => void called.push(k)])) as unknown as typeof hooks;
    for (const isMac of [true, false]) {
      called.length = 0;
      const items = (menuTemplate({ isMac, ...spy }) as Item[]).flatMap((m) => m.submenu ?? []);
      const byLabel = (label: string) => items.find((i) => i.label === label)!.click!();
      for (const label of ['Open DICOMDIR or DICOM Folder…', 'Open a Single DICOM File…', 'Save Snapshot…', 'CBCTScope Help', 'Keyboard and Mouse Reference', 'Cite CBCTScope', 'Legal Notice', 'CBCTScope Website', 'Check for Updates…']) byLabel(label);
      expect(called).toEqual(['openFolder', 'openFile', 'saveSnapshot', 'openManual', 'openShortcuts', 'openCite', 'openLegal', 'openWebsite', 'checkForUpdates']);
    }
  });
  it('the ellipsis is the single character, and no label carries a dash or a glyph', () => {
    const labels = JSON.stringify(template(true)) + JSON.stringify(template(false));
    expect(labels).not.toContain('...');
    expect(labels).not.toMatch(/[\u2013\u2014\u{1F300}-\u{1FAFF}]/u);
  });
  it('Help opens the drawer and the citation through the events the page listens for, and the page knows the pages it names', () => {
    expect(read('components/cbct/ManualDrawer.tsx')).toContain(`export const MANUAL_EVENT = '${MANUAL_EVENT}';`);
    expect(PAGE_CITE_EVENT).toBe(CITE_EVENT);
    expect(menuDrawerPage(SHORTCUTS_PAGE)).toBe(SHORTCUTS_PAGE);
    expect(menuDrawerPage(LEGAL_PAGE)).toBe(LEGAL_PAGE);
  });
  it('the File menu clicks the page controls by their test ids, and leaves an absent or disabled one alone', () => {
    const app = read('components/cbct/CbctApp.tsx');
    for (const id of [FOLDER_INPUT, FILE_INPUT, SNAPSHOT_BUTTON]) expect(app).toContain(`"${id}"`);
    expect(clickScript(SNAPSHOT_BUTTON)).toBe(
      '(() => { const el = document.querySelector("[data-testid=\\"snapshot-button\\"]"); if (el && !el.disabled) el.click(); })(); void 0',
    );
    expect(eventScript(MANUAL_EVENT)).toBe('window.dispatchEvent(new CustomEvent("cbctscope:manual")); void 0');
    expect(eventScript(MANUAL_EVENT, SHORTCUTS_PAGE)).toBe('window.dispatchEvent(new CustomEvent("cbctscope:manual", { detail: "12-shortcuts.html" })); void 0');
  });
});

describe('Check for Updates', () => {
  it('opens the website\'s update page with a strict version after the #, and the bare page otherwise', () => {
    expect(UPDATE_PAGE).toBe(`${SITE_URL}/update`);
    expect(updateUrl('2.1.0')).toBe('https://cbctscope.com/update#from=2.1.0');
    expect(updateUrl('10.20.300')).toBe('https://cbctscope.com/update#from=10.20.300');
    for (const bad of ['', '2.1', '2.1.0-beta.1', 'v2.1.0', '2.1.0.4', '2.1.0 ', '<b>', '2.1.x']) expect(updateUrl(bad), bad).toBe('https://cbctscope.com/update');
  });
  it('the page and the version panel build the same address', () => {
    for (const v of ['2.1.0', pkg.version, '2.1', 'x']) expect(updatePageUrl(v), v).toBe(updateUrl(v));
  });
  it('main.mjs opens it in the system browser and makes no request of its own', () => {
    const main = read('desktop/main.mjs');
    expect(main).toContain('checkForUpdates: () => void shell.openExternal(updateUrl(app.getVersion()))');
    expect(main).not.toMatch(/\bnet\b\s*[,}]|\bfetch\(|electron-updater|autoUpdater|https?\.request|\bhttps?\.get\(/);
    expect(read('package.json')).not.toContain('electron-updater');
  });
});

describe('About, the save panel, the port dialogue', () => {
  it('About reads the version once, the copyright, the research line and the website', () => {
    const a = aboutPanelOptions(pkg.version);
    expect(a).toMatchObject({ applicationName: 'CBCTScope', applicationVersion: pkg.version, version: '', copyright: '© 2026 Reza Motaghi' });
    expect(a.credits).toBe('Research software. Not a medical device.\nhttps://cbctscope.com\nhttps://rezamotaghi.com');
    expect(AUTHOR_SITE).toBe(AUTHOR_URL);
    expect(WEBSITE).toBe(SITE_URL);
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
