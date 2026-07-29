# Reslice

## What this mode is for

Reslice generates a fresh 2D slice stack along any path you draw on the axial scout: a
straight line at any angle, or a curved arc. It answers the question the fixed planes
cannot: "cut me a stack of slices along this exact structure," whether that is serial
cross-sections marching down a drawn line or a stack of parallel reformats through a
chosen direction. It is the general-purpose version of what Pano does for the dental
arch and TMJ does for the condyles.

## The controls

The axial scout (left) has a slice slider (wheel scrolls). The path has two phases, the
same lifecycle as the pano arch. While placing, drag a freehand stroke or click control
points: two points make a straight line, three or more make a curved arc; double-click
finishes the path. Once finished, clicks are inert: drag a dot to refine, drag the line
to move the whole path, right-click a dot to delete it. "clear path" removes the whole
path and returns to placing; "Reset path" returns the path to its position as of the
last finish. The scout also outlines the sampled band in green, showing exactly the
anatomy the stack cuts through. The path and scout slice persist per volume.

Output shape:

- "cross": planes perpendicular to the path, marched along it. On a line this walks the
  line cutting across it; on a curve it steps along the arc cutting perpendicular
  cross-sections, as in the Pano cross-sections.
- "parallel": planes containing the path direction, offset sideways. On a line this is a
  stack of parallel oblique reformats; on a curve it is the arc swept at a series of
  sideways shifts, a stack of curved reformats.

Stack controls: slices (3 to 16), distance (0.5 to 10 mm between slices), width (10 to
60 mm), thickness (0 to 10 mm averaged into each slice), and MIP (brightest voxel instead
of the average, for straight-line stacks and parallel curved reformats).

vertical crop: two handles on the right edge of the stack trim its top and bottom; the
kept band scales into the pane, and double-click on a handle resets it.

Stack rotation: right-drag on any output tile rotates the stack, the same sweep gesture
as the MPR and grid rotations. The frame is rigid: the scout goes oblique to match and
the drawn path projects onto it dashed while tilted. "reset position" returns the tilt
upright and the vertical crop to full, leaving the path, stack parameters, and the
scout|stack divider untouched (the divider drags to resize, double-click resets).

save stack: saves the whole stack as one PNG, tiled, with a caption line carrying the
volume id, stack geometry, and date.

The scout draws the path plus numbered markers showing where each output slice cuts; the
output tiles carry the matching number and the offset in mm from the path midpoint. The
middle slice of the stack is highlighted on both sides.

Window: the shared Window (HU) presets, center, width, and invert apply.

## A reading workflow

1. Scroll the scout to the slice where the structure of interest is best defined and draw
   the path along it: a line for a straight course, an arc for a curved one.
2. Choose the output shape from the question: cross-sections to examine a structure's
   short axis repeatedly along its length, parallel to view it in its own long-axis
   plane at several depths.
3. Set distance so the stack spans the structure with the sampling you need; the slice
   count times the distance is the total coverage, centered on the path midpoint.
4. Set width generously at first, then tighten it once the stack is centered where it
   should be.
5. Keep thickness near zero for fine detail, and add thickness or MIP when continuity
   through noise matters more than edge sharpness.
6. Use the numbered markers on the scout to keep every output tile anchored to its
   position in the anatomy.
7. Trim the vertical range to the region of interest so each slice is filled with
   relevant anatomy.
8. Save the stack as a PNG when the series itself is the record, or reproduce the key
   position in MPR for measurements.

## Over MCP

`open_scan`, `list_volumes`, `select_volume`, `set_view_mode` (mode `reslice`),
`set_window_level`, and `snapshot` apply; the snapshot captures the scout and the output
stack as laid out. `navigate_slice` is MPR-only; the path is drawn by hand and has no
agent verb. Example sequence: `set_view_mode` to `reslice`, `set_window_level` preset
`Bone`, `snapshot`.

## Limits

The stack exists only after a path is drawn, and its geometry is exactly the drawn
geometry: there is no automatic alignment to anatomy. The path is drawn on one axial
slice, so the cutting frame is defined in that plane; structures whose course changes
out-of-plane may need the path redrawn at another level. There are no measurement tools
here; measure in MPR. CBCTScope is navigation and visualization only: no findings, no
diagnoses. Research use only; not a medical device.
