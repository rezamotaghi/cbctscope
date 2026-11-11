# 11 · Troubleshooting

## Installation and startup

- **macOS refuses to open `Start CBCTScope.command`** ("Apple could not
  verify" or "unidentified developer"): open **System Settings**, click
  **Privacy & Security**, scroll down, click **Open Anyway**, and confirm
  **Open** in the prompt that reappears. macOS asks once for a downloaded
  file; afterwards a plain double-click works. On older macOS versions the
  same override is a right-click on the file and **Open**.
- **Windows shows a security warning for `Start CBCTScope.bat`** ("the
  publisher could not be verified", or a SmartScreen notice): choose **Run**
  (under SmartScreen, **More info**, then **Run anyway**). Windows asks this
  for files downloaded from the internet; the starter only installs and
  starts the viewer inside its own folder.
- **Node.js cannot be installed on this computer** (no administrator rights,
  a managed clinic PC): nodejs.org also offers a standalone binary that needs
  no installer, and CBCTScope itself writes nothing outside its own folder
  and the app-data folder (section 10.2). Whether either may run on a managed
  computer is the IT department's call; ask rather than work around a policy.
- **`npm: command not found`** (macOS) or **`'npm' is not recognized`**
  (Windows): Node.js is not installed yet, or the terminal was opened before
  the installation finished. Install Node.js (section 2.1), then open a new
  terminal window and retry.
- **The start command warns that port 3810 is in use**: the viewer is already
  running in another terminal window. One is enough: open
  http://localhost:3810 as is, or stop the older one with `Ctrl-C` first.
- **The desktop app says "CBCTScope is already running, or another program
  uses its port"** and quits: another program holds the port, most often the
  repository's viewer (`npm run dev` or `npm run demo`) in a terminal. Stop it
  with `Ctrl-C`, or quit the other program, then open CBCTScope again. The app
  never moves to another port, because its marks and settings belong to the
  address `http://127.0.0.1:3810`.
- **macOS asks whether you are sure you want to open CBCTScope** the first
  time the desktop app opens ("is an app downloaded from the Internet. Are you
  sure you want to open it?"): this is Gatekeeper's standard first-open
  prompt for any downloaded app. The macOS build is signed and notarised by
  Apple; choose **Open**. macOS asks once.
- **Windows shows "Windows protected your PC"** when the desktop app first
  starts: the Windows build is unsigned. Choose **More info**, then **Run
  anyway** (once; section 2.6).
- **The browser shows a connection error at localhost:3810**: the viewer is
  not running. Start it (section 2.3) and reload the tab.

## Opening scans

- **"found N compressed DICOM file(s), only uncompressed exports are
  supported"**: re-export from your CBCT unit's software with compression
  off, then open the new export.
- **"No DICOM volume found in N files"** (the web build and the desktop app):
  the panel lists what the scan saw. Compressed transfer syntax: re-export
  with compression off. Too few slices: the folder holds a short series, not a
  CBCT volume. No DICM magic bytes: those files are not DICOM. The scan stops
  at 8,000 files: open the export folder itself, not a folder that holds it
  among much else.
- **"not a DICOM file (or a compressed/foreign format)"**: the picked file is
  not uncompressed DICOM. Pick a `.dcm` slice, a DICOMDIR, or a multiframe
  file from a fresh uncompressed export.
- **The export opens but a volume is missing from the picker**: only
  uncompressed volumes are listed; a mixed export can contain compressed
  series that are skipped, with a notice naming how many.
- **"no dialog helper found" when clicking open (Linux)**: install zenity
  from your distribution's package manager (for example
  `sudo apt install zenity`), or use the one-line command in section 4.4.

## Display

- **Panes stay black or the 3D render fails**: the browser could not get
  WebGL2, usually a graphics-driver or browser-settings issue. Try another
  current browser; check that hardware acceleration is enabled.
- **The image looks flat or washed out**: the window is set for a different
  tissue. Apply **Auto**, then a preset (section 5.2). Gamma double-click
  resets to linear.
- **A huge volume is slow**: close other volumes, read in demo mode with
  nothing else open, and prefer the draft or standard quality for STL export.

## The web build and the desktop app

- **The Large volume notice appears** (in the web build and in the desktop
  app): the volume's voxels exceed the size threshold (section 4.6). The
  browser engine must hold the whole volume in memory, and a tab or the
  desktop app has less room than the repository viewer. Close other tabs or
  volumes and continue, or read it in the repository viewer (section 2.3),
  which has no such limit.
- **The tab slows down, reloads, or shows "Aw, Snap" or "out of memory" on a
  large volume**: the browser ran out of memory for this tab. Use the
  repository viewer (section 2.3) for that volume.
- **Open DICOMDIR or DICOM folder offers no folder choice, or a drop opens nothing**: the
  browser lacks folder reading. Chrome and Edge support both the folder picker
  and dropped folders; Firefox and Safari support the folder picker, and their
  support for dropped folders varies. Use **Open DICOMDIR or DICOM folder** in Chrome or Edge.
- **The browser asks whether to upload the folder**: that is the browser's
  standard wording for letting a page read files. The files are read into the
  tab; nothing is sent anywhere (section 10.5).
- **Marks are missing in another browser**: marks live in each browser's own
  storage. Carry them with **Save marks to file** and **Load marks from file**
  (section 7.3).

## Agent connection

- **The agent reports the viewer is not reachable**: both the viewer process
  and an open browser tab must be running (section 9.2). Start the viewer,
  open the tab, retry.
- **A banner says another tab holds the agent connection**: the newest tab
  always does (section 9.4). Close the extra tab, or work by hand in this
  one.

If a problem is not listed here, report it on the project's GitHub issues
page with the terminal's output; never attach patient data to a report.
