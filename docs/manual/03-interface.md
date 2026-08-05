# 3 · The interface

The whole program is one screen: a header across the top, the active reading
mode filling the rest. There are no dialogs to dismiss and no hidden panels;
every control is visible at full contrast at all times, by design.

## 3.1 The header

From left to right:

- **CBCTScope**, the program name, followed by the **version chip** (for
  example `v1.5.0`). Clicking the chip opens a short panel naming the
  software, its version, its author, and its research-use status; Escape or a
  click outside closes it. Quote the version from here when reporting a
  problem or citing the software.
- **Research use only. Not for diagnosis.** A permanent badge, not a
  dismissible banner. It states what the program is; see "Intended use" on
  the manual's front page.
- **Mode tabs**: MPR, Grid, Pano, TMJ, Reslice, Ceph, Region, Stitch. One
  click switches the reading mode; the loaded volume is untouched. Chapter 8
  introduces the modes. A 2D radiograph replaces the tabs with a single
  **2D radiograph** label, since the volume modes have nothing to act on.
- **Volume picker**: a dropdown listing every image the viewer currently
  serves, grouped as 🧬 fused (session stitches from the Stitch mode),
  📂 opened (your export), and the built-in demo phantom. Each entry shows its
  field of view, matrix, and acquisition details where present. The **‹** and
  **›** buttons, or the `N` and `P` keys, cycle through the list.
- **⇩ export**: the volume export menu (chapter 7). Shown for volumes, not
  for 2D radiographs, whose slice stacks and surface meshes have no meaning.
- **snapshot**: saves what the current mode shows as a PNG (chapter 7). This
  one button serves every mode, including 2D radiographs.
- **📂 open**: the source menu for opening and closing your own exports
  (chapter 4).
- **keys**: the keyboard reference, every hotkey in words (chapter 12).
- **Image line**: the current image's label, field of view in cm, matrix,
  source kind (slices, multiframe, or radiograph), and voxel or pixel size in
  µm.
- **Hint line** (right edge): a live reminder of the mouse and key bindings
  for the current context. It changes with the active tool and image class.

## 3.2 The mode area

Each reading mode fills the area below the header with its own panes and its
own control rail; the per-mode guides (chapters 8.1 to 8.8) document them
control by control, including each mode's own mouse gestures. Conventions
that hold across modes:

- **One snapshot button** lives in the header next to export, in the same
  place no matter which mode is open. It saves a PNG of what the current
  mode shows, exactly as displayed, to your Downloads folder; each mode
  supplies its own composition behind that one button.
- **Double-clicking any slider resets it** (navigation sliders to the volume
  middle, parameters to their defaults).
- **Disabled controls stay fully readable** and their tooltip says why they
  are unavailable; nothing dims, hides, or unmounts.
- **Pane dividers** between a mode's panes drag to resize and double-click
  back to the default split.
- Double-click is otherwise a per-mode verb: in MPR it maximizes a pane and
  restores the 2 by 2 layout on the second double-click; in Pano and Reslice
  it finishes the arch or path being drawn; on a slider or crop handle it
  resets that control.

## 3.3 Window controls

The density window (chapter 5) is set once and applies across modes: presets,
a histogram with draggable black and white cut lines, center and width
sliders, a gamma slider, and an invert checkbox.

## 3.4 The objects panel and saved views

In MPR, a side panel lists every annotation and measurement on the current
volume (chapter 6) together with **saved views**. Press `V`, or use the panel,
to save the current view: all four pane cameras plus the display state
(window, render settings). One click on a saved view restores it exactly.
Annotations and saved views persist per volume across sessions; they are
stored as small text sidecars on this machine, never inside the scan
(section 10.2).

## 3.5 Global keys

`N` / `P` next and previous volume · `1` to `9` and `0` select the tool ·
`R` reset orientation · `C` toggle plane lines · `O` toggle overlays ·
`V` save the current view · `Del` delete the selected annotation. The full
reference, including every mouse gesture, is chapter 12.
