// The desktop app's main process (docs/web-build.md, sections 1 and 12). It starts the bridge
// host (./bridge.mjs: the static web build plus the loopback agent bridge on 127.0.0.1:3810)
// and opens one window on it. The page is the web build, unchanged: it reads scans through
// the browser engine's own picker; this process never sees a file path.
//
// Hardening: context isolation, no Node in the page, the renderer sandbox, web security on,
// no preload. Every window.open and every off-origin navigation is denied; an https: link is
// handed to the system browser, anything else is dropped. The packaged app refuses to start
// with a remote-debugging switch, which would hand the window to any local process.
// The menu bar, About panel, save panel title, port dialogue and the window's remembered size
// and position come from ./native.mjs. Check for Updates hands the website's update page to the
// system browser; the app has no update check of its own and makes no request.
import { app, BrowserWindow, dialog, Menu, nativeTheme, screen, session, shell } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PortInUseError, startBridge } from './bridge.mjs';
import {
  aboutPanelOptions,
  CITE_EVENT,
  clickScript,
  debugSwitchIn,
  DEBUG_SWITCHES,
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
  updateUrl,
  WEBSITE,
  WINDOW_STATE_FILE,
  windowBoundsFor,
  windowStateToSave,
} from './native.mjs';

// seconds since the process started, so the log shows launch to first frame directly
const log = (line) => console.log(`[cbctscope ${process.uptime().toFixed(2)}s] ${line}`);

let bridge = null;
let win = null;

// a remote-debugging switch gives full control of a window that may hold a scan, past the
// bridge's checks and the navigation-only verbs: the packaged app quits before any window.
// Development (npm run desktop) keeps its tools.
const debugSwitch =
  debugSwitchIn(process.argv) ?? DEBUG_SWITCHES.find((name) => app.commandLine.hasSwitch(name)) ?? null;
if (app.isPackaged && debugSwitch) {
  for (const name of DEBUG_SWITCHES) app.commandLine.removeSwitch(name);
  log(`refusing to start: --${debugSwitch} is not allowed in the packaged app; quitting`);
  app.exit(1);
} else {
  // the profile keeps the folder name it had before the app had a productName (set before the
  // lock, which lives in the profile); an explicit --user-data-dir still wins
  if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), PROFILE_FOLDER));
  // one app, one bridge, one viewer: a second launch focuses the first window
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    });

    // the page tells the shell from a browser by this token (components/cbct/shell.ts)
    app.userAgentFallback = desktopUserAgent(app.userAgentFallback, app.getVersion());

    app.whenReady().then(boot, (err) => {
      console.error(err);
      app.exit(1);
    });
  }
}

/** run one of the menu's hooks in the page (native.mjs), as a user gesture, so a picker or a save panel may follow */
function inPage(script) {
  if (!win) return;
  win.focus();
  void win.webContents.executeJavaScript(script, true).catch(() => {});
}

function buildMenu() {
  const template = menuTemplate({
    isMac: process.platform === 'darwin',
    // File: the page's own folder and single-file pickers, and its Snapshot button
    openFolder: () => inPage(clickScript(FOLDER_INPUT)),
    openFile: () => inPage(clickScript(FILE_INPUT)),
    saveSnapshot: () => inPage(clickScript(SNAPSHOT_BUTTON)),
    // Help: the page opens its manual drawer (at the index, chapter 12 or the legal notice) and
    // its citation dialogue through the state its own help menu sets
    openManual: () => inPage(eventScript(MANUAL_EVENT)),
    openShortcuts: () => inPage(eventScript(MANUAL_EVENT, SHORTCUTS_PAGE)),
    openCite: () => inPage(eventScript(CITE_EVENT)),
    openLegal: () => inPage(eventScript(MANUAL_EVENT, LEGAL_PAGE)),
    openWebsite: () => void shell.openExternal(WEBSITE),
    // the website's update page in the system browser, the installed version after the # sign;
    // the app itself makes no request
    checkForUpdates: () => void shell.openExternal(updateUrl(app.getVersion())),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** the window's size and position from the last session (numbers only; see native.mjs) */
const windowStatePath = () => path.join(app.getPath('userData'), WINDOW_STATE_FILE);
function readWindowState() {
  try {
    return JSON.parse(readFileSync(windowStatePath(), 'utf8'));
  } catch {
    return null; // first launch, or a damaged file: the default size, centred
  }
}
function writeWindowState(w) {
  try {
    writeFileSync(windowStatePath(), JSON.stringify(windowStateToSave(w.getNormalBounds(), w.isMaximized())));
  } catch (err) {
    log(`window size not remembered: ${err.message}`);
  }
}

const isHttps = (url) => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

async function boot() {
  const root = path.join(app.getAppPath(), 'out');
  try {
    bridge = await startBridge({ root, log });
  } catch (err) {
    if (!(err instanceof PortInUseError)) throw err;
    // no other port: the origin holds the marks, the research acknowledgement and the agent
    // settings, and a different port would silently lose them (manual sections 2.6 and 11)
    log(`port ${err.port} is in use; quitting`);
    dialog.showMessageBoxSync({ type: 'error', title: 'CBCTScope', ...PORT_IN_USE, buttons: ['Quit'] });
    app.exit(1);
    return;
  }

  // nothing in the page needs a device or a notification; files come through the picker
  const allowed = new Set(['clipboard-sanitized-write', 'fullscreen', 'fileSystem']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(allowed.has(permission)));

  // a snapshot or export the page hands over: the save panel is titled for what it saves, never
  // with the data or blob URL, and starts in Downloads with the page's file name
  session.defaultSession.on('will-download', (_event, item) => {
    const filename = item.getFilename();
    item.setSaveDialogOptions({ title: saveDialogTitle(filename), defaultPath: path.join(app.getPath('downloads'), filename) });
  });

  // the app is dark: system chrome (the full-screen title area, panels, dialogues) follows it
  nativeTheme.themeSource = 'dark';
  app.setAboutPanelOptions(aboutPanelOptions(app.getVersion()));
  buildMenu();
  const place = windowBoundsFor(readWindowState(), screen.getAllDisplays().map((d) => d.workArea));
  win = new BrowserWindow({
    width: place.width,
    height: place.height,
    ...(place.x !== undefined && place.y !== undefined ? { x: place.x, y: place.y } : {}),
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    show: false,
    backgroundColor: '#0b0d10',
    title: 'CBCTScope',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // the window keeps its own title: the page's title describes the website ("free online")
  win.on('page-title-updated', (event) => event.preventDefault());

  const origin = new URL(bridge.url).origin;
  const sameOrigin = (url) => {
    try {
      return new URL(url).origin === origin;
    } catch {
      return false;
    }
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttps(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  const guard = (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    if (isHttps(url)) void shell.openExternal(url);
  };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  win.once('ready-to-show', () => {
    log('first frame (ready-to-show)');
    if (place.maximized) win.maximize();
    win.show();
  });
  // remembered on close, for the next launch: size, position, maximized
  win.on('close', () => writeWindowState(win));
  win.on('closed', () => {
    win = null;
  });
  await win.loadURL(`${bridge.url}/`);
}

// one window: closing it quits on every platform, so the bridge never outlives the viewer
app.on('window-all-closed', () => app.quit());

// quit stops the bridge: waiting commands are answered, streams closed, the port released
app.on('will-quit', (event) => {
  if (!bridge) return;
  event.preventDefault();
  const b = bridge;
  bridge = null;
  // the quit is already decided: exit once the port is released (or after 2 s at most)
  const done = () => {
    log('bridge stopped, quitting');
    app.exit(0);
  };
  Promise.race([b.close(), new Promise((r) => setTimeout(r, 2000))]).then(done, done);
});
