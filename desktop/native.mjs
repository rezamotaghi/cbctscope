// What the desktop app shows through the operating system rather than the page: the menu bar,
// the About panel, the save panel's title, the port-in-use dialogue, the window's remembered
// place, the menu's hooks into the page, the update page's address, plus the launch checks that
// run before any window exists. Pure data and functions, no Electron import, so
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

/** the author's site, as components/siteAddress.mjs AUTHOR_URL (desktop/ is packaged without components/; tests/desktopNative.test.ts pins the two equal) */
export const AUTHOR_SITE = 'https://rezamotaghi.com';

/** the event the page listens for to open its manual drawer (components/cbct/CbctApp.tsx) */
export const MANUAL_EVENT = 'cbctscope:manual';

/** the event the page listens for to open its Cite this software dialogue (components/cbct/CbctApp.tsx) */
export const CITE_EVENT = 'cbctscope:cite';

/** the manual pages and site pages the Help menu names in MANUAL_EVENT's detail (the page accepts only pages it knows) */
export const SHORTCUTS_PAGE = '12-shortcuts.html';
export const LEGAL_PAGE = 'legal';

/** the page's controls the File menu clicks, by their data-testid (components/cbct/CbctApp.tsx) */
export const FOLDER_INPUT = 'open-folder-input';
export const FILE_INPUT = 'open-file-input';
export const SNAPSHOT_BUTTON = 'snapshot-button';

// ---------------------------------------------------------------- the menu's hooks into the page
const SCRIPT_ESCAPES = {
  '<': '\\u003C',
  '>': '\\u003E',
  '/': '\\u002F',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\0': '\\0',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

/**
 * A string as a JavaScript literal for generated script text. JSON.stringify quotes it; the
 * characters that could close a script element or end a line are then written as escapes, so
 * the literal reads back as the same string wherever the script text is placed.
 * @param {string} value
 */
export function scriptLiteral(value) {
  return JSON.stringify(String(value)).replace(/[<>/\b\f\n\r\t\0\u2028\u2029]/g, (c) => SCRIPT_ESCAPES[c]);
}

/**
 * The script that clicks one of the page's controls by its test id, run with a user gesture so
 * a file picker or a download may follow. A control that is absent or disabled is left alone.
 * @param {string} testId
 */
export function clickScript(testId) {
  if (!/^[a-z][a-z0-9-]*$/.test(String(testId))) throw new TypeError(`clickScript: not a test id: ${JSON.stringify(testId)}`);
  const sel = scriptLiteral(`[data-testid="${testId}"]`);
  return `(() => { const el = document.querySelector(${sel}); if (el && !el.disabled) el.click(); })(); void 0`;
}

/**
 * The script that sends the page a window event, with an optional detail (a manual page's name).
 * Only the event crosses the window's context isolation; the page decides what it accepts.
 * @param {string} name
 * @param {string} [detail]
 */
export function eventScript(name, detail) {
  const init = detail === undefined ? '' : `, { detail: ${scriptLiteral(detail)} }`;
  return `window.dispatchEvent(new CustomEvent(${scriptLiteral(name)}${init})); void 0`;
}

// ---------------------------------------------------------------- updates
/** the website's update page; the app itself contacts nothing, the browser opens this page */
export const UPDATE_PAGE = `${WEBSITE}/update`;

/**
 * The update page with the installed version after the # sign, which the browser never sends to
 * a server; the bare page for anything but a strict major.minor.patch version
 * (components/updateCheck.ts updatePageUrl builds the same address; the tests pin them equal).
 * @param {string} version app.getVersion()
 */
export function updateUrl(version) {
  return /^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(String(version)) ? `${UPDATE_PAGE}#from=${version}` : UPDATE_PAGE;
}

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
/** the About panel: the version once, the copyright, the research-use line, the website, the author's site (plain text: the options give no way to make a link clickable) */
export function aboutPanelOptions(version) {
  return {
    applicationName: APP_NAME,
    applicationVersion: version,
    // macOS prints "Version <applicationVersion> (<version>)"; empty keeps the version once
    version: '',
    copyright: '© 2026 Reza Motaghi',
    credits: `Research software. Not a medical device.\n${WEBSITE}\n${AUTHOR_SITE}`,
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

// ---------------------------------------------------------------- the window's place
/** the smallest window the one-row header and four panes hold in */
export const MIN_WINDOW = { width: 1024, height: 700 };
/** the first launch's size, centred */
export const DEFAULT_WINDOW = { width: 1440, height: 900 };
/**
 * The one file the app writes about itself, in its profile folder: the window's size and
 * position and whether it was maximized. Numbers only; never a folder, a file name or anything
 * from a scan (the window preset is kept by the page, in the same profile).
 */
export const WINDOW_STATE_FILE = 'window-state.json';

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * What to remember when the window closes: its normal (unmaximized) bounds, rounded, and the
 * maximized flag. Nothing else goes into the file.
 * @param {{ x: number, y: number, width: number, height: number }} bounds win.getNormalBounds()
 * @param {boolean} maximized win.isMaximized()
 */
export function windowStateToSave(bounds, maximized) {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
    maximized: Boolean(maximized),
  };
}

/**
 * The window to open, from what was saved and the displays there are now. A saved window comes
 * back where it was when its top strip (where the title bar sits) still lies on a display,
 * clamped to the minimum size and to that display; otherwise, and on a first launch or a
 * damaged file, the default size centred (no x and y: Electron centres it), never larger than
 * the biggest display.
 * @param {unknown} saved the parsed file, or anything else
 * @param {{ x: number, y: number, width: number, height: number }[]} workAreas each display's work area
 * @returns {{ width: number, height: number, x?: number, y?: number, maximized: boolean }}
 */
export function windowBoundsFor(saved, workAreas) {
  const areas = (Array.isArray(workAreas) ? workAreas : []).filter((a) => a && num(a.x) && num(a.y) && num(a.width) && num(a.height));
  const biggest = areas.reduce((m, a) => (!m || a.width * a.height > m.width * m.height ? a : m), null) ?? DEFAULT_WINDOW;
  const fallback = {
    width: Math.max(MIN_WINDOW.width, Math.min(DEFAULT_WINDOW.width, biggest.width)),
    height: Math.max(MIN_WINDOW.height, Math.min(DEFAULT_WINDOW.height, biggest.height)),
    maximized: false,
  };
  const s = /** @type {Record<string, unknown>} */ (saved && typeof saved === 'object' ? saved : {});
  if (!num(s.x) || !num(s.y) || !num(s.width) || !num(s.height)) return fallback;
  const maximized = s.maximized === true;
  const x = /** @type {number} */ (s.x);
  const y = /** @type {number} */ (s.y);
  // the display holding the most of the window's top strip (40 px tall, the title bar's place)
  const strip = { x, y, width: /** @type {number} */ (s.width), height: 40 };
  let home = null;
  let best = 0;
  for (const a of areas) {
    const w = Math.min(strip.x + strip.width, a.x + a.width) - Math.max(strip.x, a.x);
    const h = Math.min(strip.y + strip.height, a.y + a.height) - Math.max(strip.y, a.y);
    if (w >= 100 && h >= 20 && w * h > best) {
      best = w * h;
      home = a;
    }
  }
  if (!home) return fallback;
  const width = Math.max(MIN_WINDOW.width, Math.min(/** @type {number} */ (s.width), home.width));
  const height = Math.max(MIN_WINDOW.height, Math.min(/** @type {number} */ (s.height), home.height));
  return {
    width,
    height,
    x: Math.round(Math.max(home.x, Math.min(x, home.x + home.width - width))),
    y: Math.round(Math.max(home.y, Math.min(y, home.y + home.height - height))),
    maximized,
  };
}

// ---------------------------------------------------------------- the menu bar
/**
 * The menu bar template, macOS conventions on macOS and the same items on Windows. Every item
 * reaches something the page already does: its two openers, its Snapshot button, its manual
 * drawer, its citation dialogue; Check for Updates opens the website's update page in the
 * system browser.
 * @param {{
 *   isMac: boolean,
 *   openFolder: () => void,
 *   openFile: () => void,
 *   saveSnapshot: () => void,
 *   openManual: () => void,
 *   openShortcuts: () => void,
 *   openCite: () => void,
 *   openLegal: () => void,
 *   openWebsite: () => void,
 *   checkForUpdates: () => void,
 * }} opts
 * @returns {import('electron').MenuItemConstructorOptions[]}
 */
export function menuTemplate({ isMac, openFolder, openFile, saveSnapshot, openManual, openShortcuts, openCite, openLegal, openWebsite, checkForUpdates }) {
  const updates = { label: 'Check for Updates…', click: checkForUpdates };
  return [
    // the application menu, spelled out so Check for Updates sits under About; Electron names
    // About, Hide and Quit after the app (APP_NAME)
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              updates,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open DICOMDIR or DICOM Folder…', accelerator: 'CmdOrCtrl+O', click: openFolder },
        { label: 'Open a Single DICOM File…', accelerator: 'CmdOrCtrl+Shift+O', click: openFile },
        { type: 'separator' },
        // the save panel follows (main.mjs will-download)
        { label: 'Save Snapshot…', accelerator: 'CmdOrCtrl+S', click: saveSnapshot },
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
        { label: 'Keyboard and Mouse Reference', click: openShortcuts },
        { type: 'separator' },
        { label: `Cite ${APP_NAME}`, click: openCite },
        { label: 'Legal Notice', click: openLegal },
        { type: 'separator' },
        { label: `${APP_NAME} Website`, click: openWebsite },
        // Windows has no app menu: Check for Updates and About sit at the end of Help
        ...(isMac ? [] : [updates, { type: 'separator' }, { role: 'about' }]),
      ],
    },
  ];
}
