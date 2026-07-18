# TMJ

## What this mode is for

TMJ reads both temporomandibular joints side by side, each in sections corrected to its
own condylar axis. The two condylar heads rarely align with the scanner's sagittal and
coronal planes, and they rarely align with each other; this mode cuts each side against
its own long axis, so the joint is read in its plane, not the scanner's. It answers the
paired question: "what does each condyle look like in properly oriented sections, and how
do the two sides compare?"

## The controls

The axial scout (left) opens near the level of the condyles, with a slice slider (wheel
scrolls). Drag one line per condyle along the long axis of the condylar head, lateral pole
to medial pole. The side is assigned automatically from the patient midline. Drag an
endpoint to adjust the axis; drag the line body to move it; right-click a line deletes it.
The lines and scout slice persist per volume.

Section orientation:

- "perpendicular to axis": sections perpendicular to each condyle's axis, the corrected
  sagittal stack, labeled A (anterior) and P (posterior).
- "parallel to axis": sections parallel to the axis, the corrected coronal stack, labeled
  lat and med.

mirror L/R: editing one side mirrors the line to the other side about the midline, for a
symmetric starting point that can then be refined per side.

clear lines: deletes both axis lines.

vertical range: dual sliders trimming the sections top and bottom to the condyle and
fossa region (the default keeps roughly the upper three quarters of the volume).

Shared section controls: sections (3 to 9 per side), spacing (0.5 to 6 mm), width (16 to
60 mm), and thickness (0 to 6 mm averaged across each section). Faint tick marks on the
scout show where each side's sections cut. Each section is labeled with its side, number,
and offset in mm from the axis midpoint.

The right side of the screen shows the RIGHT condyle row above the LEFT condyle row, each
side cut against its own axis with the same section settings.

Window: the shared Window (HU) presets, center, width, and invert apply.

## A reading workflow

1. Scroll the scout to the level where both condylar heads show their widest outline.
2. Drag one line per side along the condylar head, lateral pole to medial pole; start with
   mirror L/R if the sides are roughly symmetric, then uncheck it and refine each side on
   its own axis.
3. Set a bone window before assessing the joints; the osseous read is what these thin
   sections are for.
4. Start in the perpendicular (corrected sagittal) orientation with thin sections at close
   spacing, so the whole head is covered from lateral to medial pole.
5. Read each side lateral to medial in order, then switch to the parallel (corrected
   coronal) orientation for the mediolateral read.
6. Follow the cortical outline of each condyle across consecutive sections, and use the
   fossa and joint space in the same sections for the positional read.
7. Compare left and right at matching offsets; the rows are aligned to make side-to-side
   comparison direct, and asymmetry of the axes themselves is worth noting.
8. Keep thickness near zero for cortical detail; add 1 to 2 mm of thickness when noise,
   rather than resolution, limits the read.
9. Record the presentation with a snapshot once both rows show the joints correctly.

## Over MCP

`open_scan`, `list_volumes`, `select_volume`, `set_view_mode` (mode `tmj`),
`set_window_level`, and `snapshot` apply; the snapshot captures the scout and both
condyle rows. `navigate_slice` is MPR-only; axis lines are drawn by hand and have no
agent verb. Example sequence: `set_view_mode` to `tmj`, `set_window_level` preset
`Bone`, `snapshot`.

## Limits

Sections exist only after an axis line is drawn, and their obliquity is exactly as good
as the drawn axis. There are no measurement tools in this mode; measure in MPR at the
same location. This is a static osseous and positional presentation of a joint imaged in
one mandibular position; it says nothing about function or movement. CBCTScope is
navigation and visualization only: no findings, no diagnoses. Research use only; not a
medical device.
