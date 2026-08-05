# 7 · Exporting

Two doors lead out of the viewer, and both end on this machine's disk: nothing
is uploaded, the same local-first rule as reading.

## 7.1 Snapshots

The header's **snapshot** button (next to export, same place in every mode)
saves a PNG of what the current mode shows, exactly as displayed, to your
Downloads folder. Each mode composes its own image behind that one button:
MPR captures its visible layout with annotations, Grid its scout and tiles,
Ceph the cephalogram with its caption, Reslice the whole stack, and the other
modes their panes as laid out on screen. This is the "what I see right now"
door, for figures, teaching files, and reports written elsewhere.

## 7.2 The export menu

**⇩ export** in the header exports the current **volume** (it is hidden for 2D
radiographs). Three formats, all computed in the browser and saved to
Downloads:

- **PNG slice stack** (`.zip`): one PNG per slice at the currently displayed
  window, for slides, papers, and any image tool. Choose which planes (axial,
  sagittal, coronal) and every-nth-slice thinning. A `meta.json` with the
  geometry rides along, so the images remain measurable downstream.
- **NIfTI volume** (`.nii.gz`): the volume in HU, the lingua franca of
  research imaging tools (3D Slicer, ITK-SNAP, nibabel, MONAI).
- **STL surface mesh**: an iso-surface at a chosen HU threshold, for 3D
  printing and CAD. The threshold defaults to the 3D render's current
  cut-off, and the mesh honors the 3D crop box, so what you print is what the
  render shows. A quality selector trades resolution for time: draft (≤160³,
  about a second), standard (≤256³, a few seconds), fine (≤384³, about 15
  seconds), or full resolution (can take a minute or more).

> **Note.** Exports inherit the privacy properties of the viewer: they are
> written by your browser to your Downloads folder and nowhere else. What you
> do with an exported file is then outside the program's control; the
> patient-data responsibility travels with the file.
