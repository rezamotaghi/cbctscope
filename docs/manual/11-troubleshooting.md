# 11 · Troubleshooting

## Installation and startup

- **`npm: command not found`** (macOS) or **`'npm' is not recognized`**
  (Windows): Node.js is not installed yet, or the terminal was opened before
  the installation finished. Install Node.js (section 2.1), then open a new
  terminal window and retry.
- **The start command warns that port 3810 is in use**: the viewer is already
  running in another terminal window. One is enough: open
  http://localhost:3810 as is, or stop the older one with `Ctrl-C` first.
- **The browser shows a connection error at localhost:3810**: the viewer is
  not running. Start it (section 2.3) and reload the tab.

## Opening scans

- **"found N compressed DICOM file(s), only uncompressed exports are
  supported"**: re-export from your CBCT unit's software with compression
  off, then open the new export.
- **"not a DICOM file (or a compressed/foreign format)"**: the picked file is
  not uncompressed DICOM. Pick a `.dcm` slice, a DICOMDIR, or a multiframe
  file from a fresh uncompressed export.
- **The export opens but a volume is missing from the picker**: only
  uncompressed volumes are listed; a mixed export can contain compressed
  series that are skipped, with a notice naming how many.

## Display

- **Panes stay black or the 3D render fails**: the browser could not get
  WebGL2, usually a graphics-driver or browser-settings issue. Try another
  current browser; check that hardware acceleration is enabled.
- **The image looks flat or washed out**: the window is set for a different
  tissue. Apply **Auto**, then a preset (section 5.2). Gamma double-click
  resets to linear.
- **A huge volume is slow**: close other volumes, read in demo mode with
  nothing else open, and prefer the draft or standard quality for STL export.

## Agent connection

- **The agent reports the viewer is not reachable**: both the viewer process
  and an open browser tab must be running (section 9.2). Start the viewer,
  open the tab, retry.
- **A banner says another tab holds the agent connection**: the newest tab
  always does (section 9.4). Close the extra tab, or work by hand in this
  one.

If a problem is not listed here, report it on the project's GitHub issues
page with the terminal's output; never attach patient data to a report.
