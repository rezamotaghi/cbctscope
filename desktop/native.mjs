// What the desktop app shows through the operating system rather than the page: the menu bar,
// the About panel, the save panel's title, the port-in-use dialogue, plus the launch checks
// that run before any window exists. Pure data and functions, no Electron import, so
// tests/desktopNative.test.ts reads them without a display; desktop/main.mjs wires them up.

/** the name macOS and Windows show (menus, About, the user agent); package.json productName */
export const APP_NAME = 'CBCTScope';

/**
 * The profile folder's name before the app had a productName: Electron named it after
 * package.json `name`. Pinned, so marks, the research acknowledgement and the agent settings
 * kept under it are found again on every file system, case-sensitive ones included.
 */
export const PROFILE_FOLDER = 'cbctscope';

export const WEBSITE = 'https://cbctscope.com';

/** the event the page listens for to open its manual drawer (components/cbct/CbctApp.tsx) */
export const MANUAL_EVENT = 'cbctscope:manual';

// ---------------------------------------------------------------- launch switches
/** Chromium switches that open the window to remote control, bypassing the bridge's checks */
export const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe'];

/**
 * The first remote-debugging switch on a command line, or null. Chromium reads switches with
 * the prefixes `--` and `-` (and `/` on Windows) and lower-cases their names on Windows; the
 * check is as wide as that, and it also looks past a bare `--`, which only makes it stricter.
 * @param {readonly string[]} argv process.argv
 * @param {string} [platform] process.platform
 */
export function debugSwitchIn(argv, platform = process.platform) {
  const prefix = platform === 'win32' ? /^(?:--|-|\/)([^=\s]+)/ : /^(?:--|-)([^=\s]+)/;
  for (const arg of argv.slice(1)) {
    const m = prefix.exec(String(arg));
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (DEBUG_SWITCHES.includes(name)) return name;
  }
  return null;
}

// ---------------------------------------------------------------- the user agent
/**
 * The window's user agent with the `CBCTScope/<version>` token components/cbct/shell.ts
 * matches for IS_DESKTOP, exactly once (Electron's default already names the app).
 * @param {string} fallback app.userAgentFallback
 * @param {string} version app.getVersion()
 */
export function desktopUserAgent(fallback, version) {
  return fallback.includes(`${APP_NAME}/`) ? fallback : `${fallback} ${APP_NAME}/${version}`;
}

// ---------------------------------------------------------------- About
/** the About panel: the version once, the copyright, the research-use line, the website */
export function aboutPanelOptions(version) {
  return {
    applicationName: APP_NAME,
    applicationVersion: version,
    // macOS prints "Version <applicationVersion> (<version>)"; empty keeps the version once
    version: '',
    copyright: '© 2026 Reza Motaghi',
    credits: `Research software. Not a medical device.\n${WEBSITE}`,
    website: WEBSITE,
  };
}

// ---------------------------------------------------------------- the save panel
/** the save panel's title for a file the page hands over (never the data or blob URL) */
export function saveDialogTitle(filename) {
  return /\.(png|jpe?g)$/i.test(String(filename)) ? 'Save snapshot' : 'Save export';
}

// ---------------------------------------------------------------- the port dialogue
/** what the app says, in a native dialogue with one Quit button, when port 3810 is taken */
export const PORT_IN_USE = {
  message: 'CBCTScope is already running, or another program uses its port',
  detail:
    'Most likely the CBCTScope viewer was started from a terminal and is still running. ' +
    'Press Ctrl-C in that terminal window, or quit the other program, then open CBCTScope again. ' +
    'The app always uses the same port, so your marks and settings stay where they are.',
};

// ---------------------------------------------------------------- the menu bar
/**
 * The menu bar template, macOS conventions on macOS and the same items on Windows.
 * @param {{ isMac: boolean, openFolder: () => void, openManual: () => void, openWebsite: () => void }} opts
 * @returns {import('electron').MenuItemConstructorOptions[]}
 */
export function menuTemplate({ isMac, openFolder, openManual, openWebsite }) {
  return [
    // About, Hide, Quit: Electron names them after the app (APP_NAME)
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: openFolder },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: `${APP_NAME} Help`, click: openManual },
        { label: `${APP_NAME} Website`, click: openWebsite },
        // Windows has no app menu: About sits at the end of Help
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'about' }]),
      ],
    },
  ];
}
