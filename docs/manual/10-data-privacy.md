# 10 · Data storage and privacy

## 10.1 The stance

The safe behavior is the only behavior the software has:

- Scans are read **in place** from the folder you pick. Nothing is copied,
  converted, imported, or uploaded; closing the source releases it untouched.
- There is no hosted instance, no account, and no telemetry, and there never
  will be. The viewer works with the network cable unplugged.
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
  and HU statistics. Never pixels.
- **A source pointer**: the path of the last opened export, so normal mode can
  restore it on the next start.

Demo mode writes neither. Deleting the folder resets the viewer completely
and touches no scan. Snapshots and exports (chapter 7) are written by your
browser to Downloads, like any file a web page saves.

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
