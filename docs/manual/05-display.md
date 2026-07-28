# 5 · Display and windowing

## 5.1 The density window

A CBCT voxel is a density value in Hounsfield units (HU). The window maps a
chosen HU range onto the screen's gray scale: everything below the window
renders black, everything above renders white, and the range in between gets
the full gray ramp. A narrow window shows subtle density differences; a wide
window shows the whole span at once.

> **Caution.** CBCT HU calibration is approximate by nature. The presets and
> every HU readout in the program are starting points and raw values, not
> calibrated CT numbers.

## 5.2 Presets

| Preset | Center (HU) | Width (HU) | Typical use |
|---|---|---|---|
| Auto | from the volume | from the volume | A robust window computed from this volume's own value distribution |
| Bone | 700 | 4000 | General hard-tissue survey |
| Teeth | 1400 | 3200 | Enamel, dentin, root detail |
| Soft | 150 | 900 | Soft-tissue context, airway |

For a 2D radiograph the HU presets do not apply (the gray scale is
display-normalized, not HU); center, width, gamma, and invert work the same
way on its 0 to 4095 scale.

## 5.3 Manual control

- **Histogram**: the current volume's value distribution, with the black and
  white cut lines draggable directly on it. Below the black line renders
  black; above the white line renders white.
- **Center and width sliders**: the same window numerically. The sliders span
  this image's actual value range, and width moves on a logarithmic scale, so
  narrow diagnostic windows adjust finely while the far end still reaches the
  full span.
- **Gamma**: bends the gray ramp; 1 is linear. Double-click the slider to
  reset.
- **Invert**: white-on-black to black-on-white.

## 5.4 Slab and MIP

Each MPR pane can thicken its slice into a slab (0.1 to 20 mm). The slab
averages the voxels through its thickness; ticking **MIP** (maximum intensity
projection) takes the brightest voxel instead, which pulls high-density
structures such as roots, canals walls, and metal through the slab. Slab and
MIP are per pane, so an averaged axial can sit next to a MIP sagittal.

## 5.5 Resetting

`R` (or the reset control) returns the cameras to the standard orthogonal
orientation. A **full reset** additionally returns window, inversion, and
gamma to their defaults; over the agent connection this is the `reset_view`
verb with `full` (chapter 9).
