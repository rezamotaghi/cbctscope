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
   section 2.3 downloads the viewer's components by itself on first run (a
   few minutes, once). To install from a terminal instead, open one in the
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
mode, and opens the browser by itself once the viewer answers. The first
macOS open needs a right-click and **Open** (chapter 11).

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
