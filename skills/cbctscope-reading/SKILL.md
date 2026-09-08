---
name: cbctscope-reading
description: Drive the CBCTScope CBCT viewer through its MCP server for a human reader. Use when a user asks to open, navigate, window, bookmark, or snapshot a CBCT or dental radiograph in CBCTScope, or to run a reading choreography (MPR survey, pano survey, TMJ setup, replay saved views). Navigation only, never interpretation.
license: AGPL-3.0-or-later
compatibility: Any agent host with the cbctscope MCP server connected and the viewer running with a browser tab open (see docs/mcp.md).
metadata:
  author: Dr. Reza Motaghi
  version: "1.6.0"
---

# Reading with CBCTScope

CBCTScope is a local-first viewer for cone-beam CT volumes and 2D dental
radiographs. Its MCP server (`cbctscope`) lets you operate the viewer the way a
hand on the mouse would: open, look, move, bookmark, capture. It is research
software, not a medical device.

## The fence (read this first)

- You move the camera; the human reads. Never describe, interpret, grade, or
  diagnose what a snapshot shows, even when asked. Hand the snapshots to the
  reader with their captions and stop.
- No verb returns a finding, and none executes code. Nothing you do can make a
  scan leave the machine; `pick_scan` gives you a label, never a path.
- Name a saved view after a location or a task ("right condyle, corrected
  sagittal", "stop 3 of 5"), never after a finding. Views you save are badged
  **agent** in the viewer.

## Before you start

The viewer must be running (`npm run dev`, `npm run demo`, or the double-click
starter) with a browser tab open; otherwise every verb answers "cannot reach
the viewer" or "no viewer connected". Call `viewer_state` first: it tells you
the volume, the reading mode, the window, and where every pane stands.

## The verbs

| Verb | Use it to |
|---|---|
| `open_scan` | Open a local export by absolute path (folder, DICOMDIR, multiframe, one slice, or a radiograph file). |
| `pick_scan` | Let the reader choose in the native dialog. Returns `{ canceled: true }` when they cancel; that is normal. |
| `list_volumes` | See what can be displayed: ids, dimensions, voxel spacing, field of view. |
| `select_volume` | Display one volume by id. |
| `viewer_state` | Read what is on screen. Every mutating verb returns the same state. |
| `set_view_mode` | Switch to `mpr`, `grid`, `pano`, `tmj`, `reslice`, `ceph`, `region`, or `stitch`. |
| `set_window_level` | `Auto`, `Bone`, `Teeth`, `Soft`, or an explicit center and width; optional `invert`. |
| `set_3d_style` | Pick the 3D pane's style in MPR (for example `cbct:teeth`, `style:surface`). |
| `navigate_slice` | Move to a slice: MPR panes, the grid window centre, or the pano axial editor. |
| `navigate_arch` | Pano: move the cross-sections along the drawn arch, in mm. |
| `list_views`, `goto_view`, `save_view` | Bookmark and restore presentations in MPR. |
| `snapshot` | Capture the visible panes as a PNG with a one-line caption. |
| `reset_view` | Cameras back to orthogonal; `full: true` also resets the window. |

Resources mirror the state read-only: `cbctscope://state`, `cbctscope://volumes`,
`cbctscope://views`, `cbctscope://volume/{id}`.

## Slice numbers

Every slice number is the pane's own count, 0-based, in the direction the pane
label shows: axial superior to inferior, coronal posterior to anterior,
sagittal right to left. The pane labelled `AXIAL 622/801 S→I` is `index: 621`.
A positive `delta` moves toward the label's "to" end. Read the count from
`viewer_state` before choosing stops.

## What each mode can do

- **mpr**: everything. Slices per pane, 3D style, saved views.
- **grid**: `navigate_slice` moves the window centre; `pane` switches the plane,
  `delta` steps whole grid spacings.
- **pano**: `navigate_slice` with `pane: "axial"` moves the axial editor;
  `navigate_arch` moves the cross-sections. If the state reports no arch, ask the
  reader to draw it; no verb draws anatomy.
- **tmj, reslice, ceph, region, stitch**: mode, window, snapshot. Axis lines,
  paths, seeds, and registration are the reader's hand work.
- A 2D radiograph has no modes, no HU presets, and no 3D; numeric windowing,
  `snapshot`, and `reset_view` still work.

## Choreographies (also available as prompts)

- `mpr-survey`: `reset_view` full, `set_window_level` Bone, then for each pane
  `navigate_slice` to evenly spaced indices from first to last slice with a
  `snapshot` at each, and one final orthogonal snapshot.
- `pano-survey`: `set_view_mode` pano, `set_window_level` Teeth, confirm an arch
  exists, `navigate_arch` from 0 in fixed mm steps to the arch length, snapshot
  at each stop.
- `tmj-read`: `set_view_mode` tmj, `set_window_level` Bone, ask the reader to
  draw both condylar axes, then one snapshot of both rows.
- `replay-views`: `list_views`, then for each view `goto_view` and `snapshot`, so
  the reader can verify a set of bookmarked presentations.

## Reporting back

List the snapshots with their captions, the saved views you created (name and
id), and any step you could not perform, with the viewer's error text. Nothing
about what the images show.

## Errors you will meet

- "cannot reach the viewer": the viewer is not running; ask the reader to start it.
- "no viewer connected": no browser tab is open on the viewer.
- "this reading mode has no slice to move": switch to mpr, grid, or pano first.
- "no arch drawn": the reader draws the arch in pano's axial editor.
- Only the newest open viewer tab answers; a second tab silently takes over.
