# Pano

## What this mode is for

Pano reconstructs a curved panoramic view along the dental arch, with perpendicular
cross-sections at any position on the curve. You draw the arch once on an axial slice; the
panoramic and its cross-sections then reconstruct live. It answers the arch-wide
questions: surveying the dentition and jaws in one familiar panoramic layout, then
dropping into a cross-section to see any point in its buccolingual dimension, including
the course of the mandibular canal traced in three dimensions.

## The controls

The arch editor (left) shows an axial slice with its own slice slider (wheel scrolls).
The arch has two phases. While PLACING, draw the arch in one freehand stroke or click
control points along it; double-click finishes the arch (a stray double-click dot is
popped, not kept). Once FINISHED, clicks on the slice are inert: drag a dot to refine it,
drag the line itself to move the whole arch, double-click or right-click a dot to delete
it. The status chip under the editor always names the phase. "Auto arch" proposes the
arch from the anatomy of the current slice, to be adjusted by dragging the dots. "Delete
arch" removes the whole line (clearing the pano and cross-sections) and returns to
placing; "Reset arch" puts the arch back to its position as of the last finish, undoing
dot and whole-arch drags. The arch persists per volume across sessions.

The editor also draws the slab envelope: two green curves flanking the band of anatomy
the pano actually samples, centered on the rendered layer (radius shift and the adaptive
bend included) and closed at the arch ends. What sits between the curves is in the pano;
what sits outside is not.

The pano canvas: click or wheel moves the cross-section position along the arch; a ruler
marks arc-length in mm. Its controls:

- section position along arch: the same movement as a slider, in mm.
- slab (2 to 40 mm): the depth sampled around the arch layer; MIP switches the slab from
  average to brightest-voxel.
- layers (1, 3, or 5) and layer spacing (0.5 to 6 mm): a stack of parallel pano layers to
  flip through the focal trough.
- radius shift (-8 to +8 mm): slides the whole sampling layer buccal or lingual without
  redrawing the arch; double-click resets.
- adaptive layer: the layer bends buccal or lingual to follow the sharpest anatomy; click
  again to return to the flat drawn layer.
- pano enhance: a one-click contrast window computed from the pano's own pixels plus light
  sharpening; click again to undo.
- vertical crop: two handles on the pano's right edge. Drag the top handle down or the
  bottom handle up to cut skull base or hyoid level out of the pano and sections; the
  kept band scales into the fixed pane, and double-click on a handle resets it. This is
  a real cut of the sampled range, not a mask.

Cross-sections: sections (1 to 9), section width (10 to 50 mm), spacing (1 to 10 mm),
thickness (0 to 10 mm averaged along the arch), and mirror, which flips which side of the
arch faces left in every section. Each section is numbered to match its line on the axial
editor and on the pano, and labeled with its arc position in mm.

Section rotation: right-drag on any cross-section rotates the section fan, the same sweep
gesture as the MPR and grid rotations, with a live degree chip. The tilt drives the whole
frame rigidly: the pano re-cuts with the same leaning vertical, the axial editor goes
oblique to match, and the arch and canal traces stay visible on it as dashed true
projections. "reset position" returns the reading position (sections to mid-arch, tilt
upright, full vertical crop, radius shift zero) while leaving the arch, slab settings,
and pane layout untouched. The pane dividers between editor, pano, and sections drag to
resize and double-click to reset.

Canal traces: "+ nerve" or "+ root canal" starts a trace. Click along the canal on the
pano to add points; click on a cross-section to set the exact buccolingual position and
height at that arc position; right-click a point on the pano deletes it. "done tracing"
stops adding points. Each trace is a 3D polyline in volume space, projected live onto the
pano as a colored line, onto every cross-section as a crossing dot, and onto the axial
editor as dots. Traces can be hidden or deleted per trace and persist in the evidence
sidecar.

Measure: the measure button turns dragging on the pano or a cross-section into a mm
measurement on that reformat surface; right-click a line deletes it, and "clear" removes
all of them. Measurements persist with the traces.

Window: the shared Window (HU) presets, center, width, and invert apply (pano enhance
overrides them for the pano until toggled off).

## A reading workflow

1. Scroll the axial editor to a slice through the tooth-bearing arch and draw the arch in
   one stroke through the middle of it, or start from "auto arch" and adjust the dots.
2. Draw the arch through the roots and alveolar process rather than the crowns, so the
   pano layer carries the structures the read is about.
3. Set slab thickness to cover the buccolingual spread of the arch; widen it, or add
   layers, when structures fall outside the focal trough and blur out.
4. Trim the vertical range to the jaws so the pano rows are anatomy, not skull base.
5. Survey the pano end to end at a bone or teeth window, using the arc ruler to keep track
   of position.
6. At each point of interest, click the pano to center the cross-sections there and read
   the buccolingual dimension the pano itself cannot show.
7. To follow the mandibular canal, start a nerve trace, click along the canal on the pano,
   then correct each point's buccolingual position on the cross-sections.
8. Measure on the surface where the distance actually lies: pano for mesiodistal spans
   along the arch, cross-sections for heights and buccolingual widths.
9. Take an MCP or MPR snapshot for the record once the layout shows what it should.

## Over MCP

`open_scan`, `list_volumes`, `select_volume`, `set_view_mode` (mode `pano`),
`set_window_level`, and `snapshot` apply; the snapshot captures the axial editor, the
pano, and the cross-sections as laid out. `navigate_slice` is MPR-only, and arch drawing
and tracing are hand work with no agent verb. Example sequence: `set_view_mode` to
`pano`, `set_window_level` preset `Teeth`, `snapshot`.

## Limits

The pano is a reformat, not a projection radiograph: what it shows depends on the drawn
arch and layer settings, and structures outside the sampled slab are simply absent.
Measurements on the pano and sections are computed in mm on the reformat surface, which
is only as anatomically faithful as the arch it was built on. Traces are reader-drawn
navigation aids, not detected anatomy. CBCTScope is navigation and visualization only:
no findings, no diagnoses. Research use only; not a medical device.
