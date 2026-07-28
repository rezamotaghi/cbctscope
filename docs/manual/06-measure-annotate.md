# 6 · Measuring and annotating

Measurement and annotation live on the MPR slice panes. All distances are true
millimetres computed in volume geometry, and all density statistics are raw HU
(section 5.1's calibration caution applies). The MPR guide (chapter 8.1)
covers the reading workflow; this chapter is the tool reference.

## 6.1 The tool palette

The active tool runs on the left mouse button. Keys `1` to `9` and `0` select
tools in palette order:

| Key | Tool | What it does |
|---|---|---|
| 1 | Crosshairs | Click spots the crosshairs to that point in all planes; drag pans the pane |
| 2 | Pan | Drag moves the slice in the pane |
| 3 | Length | Two points, distance in mm |
| 4 | Angle | Three points, angle in degrees |
| 5 | Arrow | An arrow with a text label (prompted) |
| 6 | Text | A text label (prompted) |
| 7 | Rect ROI | A rectangle with density statistics |
| 8 | Ellipse ROI | An ellipse with density statistics |
| 9 | Freehand | An open stroke measures a curved path in mm; closing the loop makes a region with density statistics |
| 0 | 3D ROI | A rectangle extended through the slice by the box-depth slider (1 to 60 mm), returning volume and density statistics, outlined in the 3D pane |

## 6.2 Selecting and deleting

Select an annotation by shift-clicking it on a pane, or by clicking its row in
the objects panel. `Del` (or `Backspace`) deletes the selection.

## 6.3 The objects panel

The panel lists every annotation and measurement on the current volume with
its values, alongside the saved views (section 3.4). Rows select, restore, and
delete in one click.

## 6.4 Persistence

Annotations, saved views, and 3D ROIs persist per volume across sessions.
They are stored as small text sidecars in the app-data folder on this machine
(labels, world-mm coordinates, HU statistics; never pixels; section 10.2), so
reopening the same export finds them again, and the scan itself is never
modified.
