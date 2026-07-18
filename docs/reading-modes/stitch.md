# Stitch

## What this mode is for

Stitch rigidly registers two CBCT volumes of the same subject and fuses them into one
larger volume that then reads in every mode. It answers the coverage question: when a
region of interest spans two acquisitions, or two scans of the same patient need to be
read in one frame, this aligns them and merges them into a single volume. The current
volume is A; you pick B from the catalog.

## The controls

Volume picker: A is the current volume (shown green); pick B (shown magenta) from the
same-patient candidates in the catalog. Fused volumes are excluded as inputs.

Alignment:

- auto align: finds the best translation by maximizing density cross-correlation (an NCC
  hill-climb) over the overlap.
- auto + rotation: also searches rotation; slower.
- reset transform: returns B to the identity transform.
- Manual sliders: translation X, Y, Z (-60 to 60 mm) and rotation rX, rY, rZ (-20 to 20
  degrees). Double-click a slider to zero that axis.

Overlay modes for the tri-plane preview: color (A green, B magenta, so overlap reads
neutral grey and misalignment shows as colored fringes), blend (average of the two),
checker (alternating tiles of A and B), A (A only), and B (B only).

Preview: axial, sagittal, and coronal panes rendered at A's center. An overlap NCC
readout updates whenever the transform settles; higher is better, and it turns green
above a threshold.

bake & load: resamples both volumes onto one shared grid, averaging the overlap, registers
the fused volume, uploads it to the server, and switches the viewer to it in MPR. The
fused volume gets a `fused_` id and lives in server memory for this session only.

Window: the shared Window (HU) presets, center, width, and invert control the preview.

## A reading workflow

1. Confirm A is the volume you want as the base, then pick B from the same patient; the
   picker only offers same-catalog candidates.
2. Use the color overlay from the start: perfect overlap reads neutral, and any colored
   fringe is misalignment you can see directly.
3. Run auto align first for the translation, then auto + rotation if the two scans are
   also rotated relative to each other.
4. Refine by hand with the sliders while watching both the fringes and the NCC readout;
   nudge the axis whose fringe is largest.
5. Cross-check the alignment on all three planes, not just one; a transform that looks
   right axially can still be off in the superior-inferior direction.
6. Switch to blend or checker to confirm continuity of structures across the seam once
   the color overlay looks aligned.
7. When the fringes are minimal and the NCC is as high as it will go, bake and load, then
   read the fused volume in MPR and the other modes as usual.
8. Remember the fused volume is session-only; re-derive it if you need it again later.

## Over MCP

`open_scan`, `list_volumes`, `select_volume`, `set_view_mode` (mode `stitch`),
`set_window_level`, and `snapshot` apply; the snapshot captures the tri-plane overlay.
Registration, the overlay mode, and bake are on-screen controls with no agent verb. Once
a fusion is baked, its `fused_` volume appears in `list_volumes` and can be opened with
`select_volume`. Example sequence: `set_view_mode` to `stitch`, `snapshot`, then after
baking, `list_volumes` and `select_volume` on the new fused id.

## Limits

Registration here is rigid only (translation and rotation): it assumes the two scans
differ by a rigid body transform and cannot correct for distortion, growth, or
differences in acquisition geometry between them. It is meant for two scans of the same
subject; aligning unrelated volumes is meaningless. The NCC score measures overlap
similarity, not anatomical correctness, and the reader's eyes on the fringes are the real
check. The fused volume is held in server memory for the session and is not persisted.
CBCTScope is navigation and visualization only: no findings, no diagnoses. Research use
only; not a medical device.
