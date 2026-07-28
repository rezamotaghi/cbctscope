# 2 · Installation and startup

## 2.1 System requirements

- **Node.js 22 or later**: the free runtime that runs the viewer. Download the
  LTS installer from [nodejs.org](https://nodejs.org) and run it with the
  default options.
- **A current desktop browser** with WebGL2 (Chrome, Edge, Firefox, or
  Safari). The 3D render and all reformats are computed on this machine, so a
  recent computer with a working graphics driver is assumed; large volumes
  read more comfortably with more memory.
- **macOS, Windows, or Linux.** The native file-open dialog is currently
  macOS-only; section 4.4 gives the equivalent one-line command for the other
  platforms.

## 2.2 Installing

1. Get the code: on the GitHub project page, click the green **Code** button,
   choose **Download ZIP**, and unzip it somewhere permanent. With git,
   `git clone` works as usual.
2. Open a terminal in the unzipped `cbctscope` folder.
   On macOS: open Terminal, type `cd ` with a trailing space, drag the folder
   onto the Terminal window, press return.
   On Windows: open the folder in Explorer, click the address bar, type
   `cmd`, press enter.
3. Run `npm install`. This one-time step downloads the viewer's components
   and takes a few minutes.

Updating to a newer release is the same procedure with the newer code, and
`npm install` again. Uninstalling is deleting the folder; section 10.2
describes the one small app-data folder that the viewer writes elsewhere.

## 2.3 Starting and stopping

Start the viewer from a terminal in the `cbctscope` folder:

```sh
npm run demo
```

On Windows use `npm run dev` instead (the demo flag is set with Unix shell
syntax; the viewer is identical, the difference is in section 2.4). Then open
**http://localhost:3810** in your browser. The synthetic phantom loads
immediately.

To stop the viewer, press `Ctrl-C` in the terminal or close its window. The
browser tab then shows a connection error, which is expected. Restarting takes
only the start command; `npm install` is not repeated.

> **Note.** The viewer serves exactly one reader on one machine. It refuses
> connections from other devices by design; it is not a PACS and cannot be
> made into one.

## 2.4 Demo mode and normal mode

`npm run demo` starts **demo mode**: the viewer never restores and never
remembers an opened scan, so a screen recording or a teaching session can
never accidentally surface a previous real case. Scans can still be opened
deliberately within the session.

`npm run dev` starts **normal mode**: identical viewer, but the last opened
source is remembered and restored on the next start, which is the convenient
behavior for daily reading.

On first launch both modes show the synthetic phantom.
