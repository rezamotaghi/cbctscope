# 2 · Installation and startup

## 2.1 System requirements

- **Node.js 22 or later**: the free runtime that runs the viewer. Download the
  LTS installer from [nodejs.org](https://nodejs.org) and run it with the
  default options.
- **A current desktop browser** with WebGL2 (Chrome, Edge, Firefox, or
  Safari). The 3D render and all reformats are computed on this machine, so a
  recent computer with a working graphics driver is assumed; large volumes
  read more comfortably with more memory.
- **macOS, Windows, or Linux.** The file-open dialog is native on macOS and
  Windows; on Linux it uses the desktop's dialog helper (zenity or kdialog,
  one of which most distributions ship). Section 4.4 gives a one-line
  fallback command for a Linux desktop with neither.

## 2.2 Installing

1. Get the code: on the GitHub project page, click the green **Code** button,
   choose **Download ZIP**, and unzip it somewhere permanent. With git,
   `git clone` works as usual.
2. On macOS and Windows, that is the whole installation: the starter file in
   section 2.3 downloads the viewer's components by itself on first run
   (once; section 2.3 gives the size). To install from a terminal instead,
   open one in the
   unzipped `cbctscope` folder and run `npm install`.
   On macOS: open Terminal, type `cd ` with a trailing space, drag the folder
   onto the Terminal window, press return.
   On Windows: open the folder in Explorer, click the address bar, type
   `cmd`, press enter.

Updating to a newer release is the same procedure with the newer code, and
`npm install` again. Uninstalling is deleting the folder; section 10.2
describes the one small app-data folder that the viewer writes elsewhere.

## 2.3 Starting and stopping

**By double-click** (macOS and Windows): in the `cbctscope` folder,
double-click **Start CBCTScope.command** (macOS) or **Start CBCTScope.bat**
(Windows). It installs on first run if needed, starts the viewer in normal
mode, and opens the browser by itself once the viewer answers. If macOS or
Windows shows a security prompt on this first open, chapter 11 gives the
one-time answer for each system. The first run downloads the viewer's
components once: about 130 MB downloaded, 600 MB on disk, ten to fifteen
seconds on the author's Mac and connection in September 2026, longer on a
slow one.

**From a terminal** (any OS, and the way to choose demo mode): in the
`cbctscope` folder run

```sh
npm run dev
```

for normal mode, or `npm run demo` for demo mode (section 2.4). Then open
**http://localhost:3810** in your browser. The synthetic phantom loads
immediately.

To stop the viewer, press `Ctrl-C` in its window or close the window. The
browser tab then shows a connection error, which is expected. Restarting takes
only the start step; `npm install` is not repeated.

> **Note.** The viewer serves exactly one reader on one machine. It refuses
> connections from other devices by design; it is not a PACS and cannot be
> made into one.

## 2.4 Demo mode and normal mode

`npm run demo` starts **demo mode**: the viewer never restores and never
remembers an opened scan, so a screen recording or a teaching session can
never accidentally surface a previous real case. Scans can still be opened
deliberately within the session.

`npm run dev` and the double-click starters run **normal mode**: identical
viewer, but the last opened source is remembered and restored on the next
start, which is the convenient behavior for daily reading.

Both commands behave the same on every OS.

On first launch both modes show the synthetic phantom.

## 2.5 The web build

The viewer also runs in a browser with nothing installed: the **web build**,
deployed to the project's GitHub Pages site by every published release. It is
static files only, with no server behind it. It needs only a current desktop
browser with WebGL2; Chrome or Edge read folders most reliably (chapter 11).

What differs from the local app:

- Scans are opened with the browser's own picker or by a drop on the viewer
  (section 4.6), and read into the tab. Nothing is uploaded.
- Marks live in the browser's storage and travel as a marks file (section 7.3).
- A volume above the size threshold (512 MiB of voxels by default) shows a
  notice first, because the browser must hold it in memory. The local app has
  no such limit.
- There is no MCP connection in a plain browser (chapter 9); the desktop app
  (section 2.6) adds it. The opt-in in-page navigation agent, on your own
  model account, works in both (section 9.6).
- The header reads **Research use only. Not a medical device.** at all times,
  and links to the repository, to this manual as **Manual** (a new tab, served
  by the site itself), and, as **Download the desktop app**, to the releases
  page. In the desktop app, **Manual** opens the manual drawer instead
  (section 3.1).

To build it yourself: `npm run build:web` writes the site to `out/`. Serve
that folder with any static file server. The threshold is set at build time
with `NEXT_PUBLIC_CBCTSCOPE_SIZE_NOTICE_MIB`; a site under a sub-path (such as
`/cbctscope`) needs `NEXT_PUBLIC_BASE_PATH`.

## 2.6 The desktop app

The **desktop app** is the web build in its own window, with the AI-agent
bridge built in: no Node.js, no terminal, no browser tab to keep open. It runs
the same browser engine the web build is tested on (Chromium, through
Electron), so every reading mode behaves the same.

**Download.** Every release that carries it lists the files on the project's
GitHub releases page:

- macOS: `CBCTScope-<version>-arm64.dmg` for Apple silicon,
  `CBCTScope-<version>-x64.dmg` for an Intel Mac (a `.zip` of each is there
  too). Open the dmg and drag **CBCTScope** into **Applications**. The macOS
  build is signed and notarised by Apple.
- Windows: `CBCTScope-<version>-setup.exe` installs for the current user;
  `CBCTScope-<version>-portable.exe` runs without installing. Both are
  unsigned, so on first launch Windows SmartScreen shows **Windows protected
  your PC**: choose **More info**, then **Run anyway** (once).

**First launch.** The window opens on the synthetic phantom, as the web build
does. **File → Open DICOMDIR or DICOM folder** (`Cmd-O` on macOS, `Ctrl-O` on Windows) or the
**📂 open** menu opens your own export through the system's folder dialog; the
dialog's button may read **Upload**, which is the browser engine's standard
wording: the files are read into the app and nothing is sent anywhere. Closing
the window quits the app.

What differs from the repository starters (section 2.3):

- Scans are read the web build's way (section 2.5): through the dialog or a
  drop, into the app's memory, with marks in the app's own storage and the
  marks file to carry them. The large-volume notice applies.
- The app opens no browser and asks for no install step; updating is
  downloading the newer release.
- AI-agent control works with the same setup as the repository (chapter 9):
  the app listens on `http://127.0.0.1:3810`, the address the MCP server and
  the one-click bundle use by default. If another program already holds port
  3810 (the repository's viewer, for example), the app takes a free port and
  shows its address in a yellow line at the top of the window; set
  `CBCTSCOPE_URL` to that address in the MCP server's settings. Marks are kept
  per address, so a session on a fallback port does not see the marks of one
  on 3810.
- The app accepts connections from this computer only, exactly as the
  repository's viewer does.
- The agent verbs `open_scan` and `pick_scan` are not available in the app:
  it has no route that takes a file path. Open the scan with **Open DICOMDIR or DICOM folder**,
  then the agent reads the catalog with `list_volumes`.

To build it yourself: `npm run desktop` starts it from the repository against
`out/` (building the web target first if `out/` is missing), and
`npm run desktop:build` packages it into `dist-desktop/`.
