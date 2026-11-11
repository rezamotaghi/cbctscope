// The desktop app's main process (docs/web-build.md, sections 1 and 12). It starts the bridge
// host (./bridge.mjs: the static web build plus the loopback agent bridge on 127.0.0.1:3810)
// and opens one window on it. The page is the web build, unchanged: it reads scans through
// the browser engine's own picker; this process never sees a file path.
//
// Hardening: context isolation, no Node in the page, the renderer sandbox, web security on,
// no preload. Every window.open and every off-origin navigation is denied; an https: link is
// handed to the system browser, anything else is dropped. The packaged app refuses to start
// with a remote-debugging switch, which would hand the window to any local process.
// The menu bar, About panel, save panel title and port dialogue come from ./native.mjs.
import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell } from 'electron';
import path from 'node:path';
import { PortInUseError, startBridge } from './bridge.mjs';
import {
  aboutPanelOptions,
  debugSwitchIn,
  DEBUG_SWITCHES,
  desktopUserAgent,
  MANUAL_EVENT,
  menuTemplate,
  PORT_IN_USE,
  PROFILE_FOLDER,
  saveDialogTitle,
  WEBSITE,
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

/** the page's own folder picker, clicked with a user gesture (the menu item and its shortcut) */
function openFolder() {
  if (!win) return;
  win.focus();
  void win.webContents
    .executeJavaScript(`document.querySelector('[data-testid="open-folder-input"]')?.click(); void 0`, true)
    .catch(() => {});
}

/** Help: the page opens its own manual drawer, as a click in its help menu would */
function openManual() {
  if (!win) return;
  win.focus();
  void win.webContents
    .executeJavaScript(`window.dispatchEvent(new Event(${JSON.stringify(MANUAL_EVENT)})); void 0`, true)
    .catch(() => {});
}

function buildMenu() {
  const template = menuTemplate({
    isMac: process.platform === 'darwin',
    openFolder,
    openManual,
    openWebsite: () => void shell.openExternal(WEBSITE),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
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
    win.show();
  });
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
