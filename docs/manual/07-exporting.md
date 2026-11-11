# 7 · Exporting

Two doors lead out of the viewer, and both end on this machine's disk: nothing
is uploaded, the same local-first rule as reading.

## 7.1 Snapshots

The header's **Snapshot** button (next to Export, same place in every mode)
saves a PNG of what the current mode shows, exactly as displayed, to your
Downloads folder. Each mode composes its own image behind that one button:
MPR captures its visible layout with annotations, Grid its scout and tiles,
Ceph the cephalogram with its caption, Reslice the whole stack, and the other
modes their panes as laid out on screen. This is the "what I see right now"
door, for figures, teaching files, and reports written elsewhere.

A 2D radiograph answers the same button. Because it is a single image rather
than a layout, its snapshot is the whole frame at full resolution with the
displayed window, gamma, and invert baked in; on-screen zoom and pan are a
reading aid and do not crop the saved PNG.

## 7.2 The export menu

**Export** in the header exports the current **volume** (it is hidden for 2D
radiographs). Three formats, all computed in the browser and saved to
Downloads:

- **PNG slice stack** (`.zip`): one PNG per slice at the currently displayed
  window, for slides, papers, and any image tool. Choose which planes (axial,
  sagittal, coronal) and every-nth-slice thinning. A `meta.json` with the
  geometry rides along, so the images remain measurable downstream. Filenames
  carry the 0-based voxel index along the axis (the same index space as the
  geometry and the NIfTI export), which for axial and coronal runs opposite to
  the on-screen count: on-screen slice k of n is file n-k on those two planes and
  file k-1 on sagittal. `meta.json` states this, so a figure can be traced back
  to the pane number it was read under.
- **NIfTI volume** (`.nii.gz`): the volume in HU, the lingua franca of
  research imaging tools (3D Slicer, ITK-SNAP, nibabel, MONAI).
- **STL surface mesh**: an iso-surface at a chosen HU threshold, for 3D
  printing and CAD. The threshold defaults to the 3D render's current
  cut-off, and the mesh honors the 3D crop box, so what you print is what the
  render shows. A quality selector trades resolution for time: draft (≤160³,
  about a second), standard (≤256³, a few seconds), fine (≤384³, about 15
  seconds), or full resolution (can take a minute or more).

The menu closes on Escape or on a click outside it, but never while an export
is running (the progress line has to stay visible) and never while you are
typing in one of its own fields, so a stray click cannot eat a half-entered
slice interval or threshold. On a short window the panel scrolls inside
itself rather than running its buttons off the bottom of the screen.

> **Note.** Exports inherit the privacy properties of the viewer: they are
> written by your browser to your Downloads folder and nowhere else. What you
> do with an exported file is then outside the program's control; the
> patient-data responsibility travels with the file.

## 7.3 The marks file (web build)

In the web build (section 2.5) marks are kept in the browser's own storage,
one record per volume, so they survive closing the tab in that browser. To
carry them to another browser or computer, the **Open** menu offers:

- **Save marks to file** downloads the marks of the volume on screen
  (measurements, labels, saved views, 3D ROIs, pano traces) as
  `<volume id>_marks.json`. It holds labels, world-mm coordinates, and HU
  statistics, the same content as the local app's sidecar. Never pixels.
- **Load marks from file** replaces the marks of the volume on screen with
  a marks file saved earlier for that same scan. The viewer does not refuse a
  file by its volume id: the local app and the web build derive different ids
  for the same export, so a file saved by one loads in the other. The loaded
  marks are bound to the volume on screen. Marks are world-mm coordinates of
  one scan, so load a file only onto the scan it was saved from: on another
  scan the marks land in the wrong places. Each mark is checked before it is
  stored: a measurement of an unknown tool, a point that is not three numbers,
  or a malformed saved view or ROI is left out, and the viewer says how many
  entries it left out; the rest loads. A file that is not a marks file, or is
  too deeply nested to read, is refused with a plain message and nothing is
  stored.
