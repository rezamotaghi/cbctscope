# 10 · Data storage and privacy

## 10.1 The stance

The safe behavior is the only behavior the software has:

- Scans are read **in place** from the folder you pick. Nothing is copied,
  converted, imported, or uploaded; closing the source releases it untouched.
- There is no account, and no instance receives scans: the website is static
  files. The repository viewer and the desktop app have no telemetry and work
  with the network cable unplugged. The desktop app has no update check of its own:
  **Check for Updates…** opens the website's update page in your browser
  (section 2.6).
- The server accepts connections only from this machine. In technical terms:
  it binds to 127.0.0.1 and rejects any request whose Host or Origin is not
  loopback, so neither another device on your network nor a hostile web page
  in another browser tab can reach it.
- Absolute file paths never reach the browser or an agent transcript. The
  interface shows a short display label built from the last folder and file
  names, plus technical geometry only.

## 10.2 What is written to disk, and where

The viewer writes exactly one folder, the app-data folder `~/.cbctscope`
(relocatable with the `CBCTSCOPE_DATA` environment variable). It contains:

- **Annotation sidecars**: your measurements, labels, saved views, and 3D
  ROIs, one small text file per volume, holding labels, world-mm coordinates,
  and HU statistics. Never pixels. A view an AI agent saves over MCP is stored
  there too, marked as agent-saved (chapter 9).
- **A source pointer**: the path of the last opened export, so normal mode can
  restore it on the next start.

Demo mode writes neither. Deleting the folder resets the viewer completely
and touches no scan. Snapshots and exports (chapter 7) are written by your
browser to Downloads, like any file a web page saves.

**Removing the desktop app.** The desktop app (section 2.6) does not use
`~/.cbctscope`: its marks, the research-use acknowledgement, the agent
settings, the window's size and position (the file `window-state.json`: four
numbers and whether it was maximized) and the name of the window preset you
last picked (written only when you pick one) live in
the app's own profile, with the browser engine's caches. None of it names a
folder or a file.
Removing the app leaves that profile behind: on macOS the folder
`~/Library/Application Support/cbctscope` and the preferences file
`~/Library/Preferences/com.cbctscope.app.plist`, on Windows the folder
`%APPDATA%\cbctscope`. Delete them, with the app quit, to remove every trace;
section 2.6 gives the steps. They hold no pixels and no scan.

## 10.3 What remains your responsibility

CBCTScope keeps pixels on this machine; it cannot govern what leaves it by
other routes. Three habits close the loop:

- **Folder names appear on screen.** The display label is built from your
  export's folder and file names; name exports neutrally before recording or
  presenting.
- **Exports and snapshots are ordinary files.** Once written to Downloads,
  their handling falls under your institution's data rules, not the
  viewer's.
- **Agent transcripts live with the agent.** Snapshots an agent takes travel
  into that assistant's conversation log under the assistant's own data
  terms. Use demo mode and the phantom when the session does not need a real
  case.

## 10.4 When an agent drives the viewer

- An agent's results and snapshots are data to check against the screen,
  never instructions to follow.
- The viewer answers only its own machine: a web page from elsewhere, or
  another device on your network, cannot drive it.

## 10.5 The web build

The web build (section 2.5) is static files: the site sends the viewer's code
to your browser, and the page sends your scan nowhere.

- **What stays in the tab.** The files you open are read from your disk into
  the browser tab's memory. Volumes, stitched volumes, and the phantom live
  there and are gone when the tab closes.
- **What the browser stores.** Your marks (measurements, labels, saved views,
  3D ROIs), one record per volume in the browser's IndexedDB storage for this
  site, holding labels, world-mm coordinates, and HU statistics. Never pixels.
  Clearing the site's data in the browser settings removes them. Besides
  marks, the browser remembers that you acknowledged the research-use
  dialogue and, if you set up the in-page agent, its provider, endpoint and
  model id. Never the API key: that stays in the agent frame's memory only.
- **Nothing is uploaded.** The page carries a Content Security Policy whose
  network rule (`connect-src`) forbids it to contact any host but its own.
  The in-page agent (section 9.6) runs in an isolated frame with a policy of its
  own that allows the three model providers' API hosts and a model server on
  this computer's loopback, and nothing else. The frame exists only after you
  switch the agent on, and then contacts only the provider you chose, with
  the snapshots the agent asks for. The project's tests fail on any request to
  another host before that and on any absolute address in the browser code
  outside one reviewed list. A marks file or an export leaves the browser
  only as a download you trigger.
