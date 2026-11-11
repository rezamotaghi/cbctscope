# 3 · The interface

The whole program is one screen: a header across the top, the active reading
mode filling the rest. There are no dialogs to dismiss and no hidden panels;
every control is visible at full contrast at all times, by design.

## 3.1 The header

![The header on the built-in phantom, numbered left to right: name and version chip, the research-use badge, the mode tabs, the volume picker, export, snapshot, open, the image line, the hint line, keys, and help](../media/manual/header.webp)

From left to right (the numbers match the callouts in the picture):

1. **CBCTScope**, the program name, followed by the **version chip** (for
   example `v2.0.0`). Clicking the chip opens a short panel naming the
   software, its version, its author, and its research-use status; Escape or a
   click outside closes it. Quote the version from here when reporting a
   problem or citing the software.
2. **Research use only. Not for diagnosis.** A permanent badge, not a
   dismissible banner. It states what the program is; see "Intended use" on
   the manual's front page.
3. **Mode tabs**: MPR, Grid, Pano, TMJ, Reslice, Ceph, Region, Stitch. One
   click switches the reading mode; the loaded volume is untouched. Chapter 8
   introduces the modes. A 2D radiograph replaces the tabs with a single
   **2D radiograph** label, since the volume modes have nothing to act on.
4. **Volume picker**: a dropdown listing every image the viewer currently
   serves, grouped as 🧬 fused (session stitches from the Stitch mode),
   📂 opened (your export), and the built-in demo phantom. Each entry shows its
   field of view, matrix, and acquisition details where present. The **‹** and
   **›** buttons, or the `N` and `P` keys, cycle through the list.
5. **⇩ export**: the volume export menu (chapter 7). Shown for volumes, not
   for 2D radiographs, whose slice stacks and surface meshes have no meaning.
6. **snapshot**: saves what the current mode shows as a PNG (chapter 7). This
   one button serves every mode, including 2D radiographs.
7. **📂 open**: the source menu for opening and closing your own exports
   (chapter 4).
8. **keys**: the keyboard reference, every hotkey in words (chapter 12).
9. **help ▾**: two entries, the reading guide for the current mode (chapter 8)
   and this manual. The viewer serves the manual itself, so it needs no
   network. In the local app and the desktop app it opens in a drawer at the
   right edge that narrows the viewer and covers no control, with the
   manual's contents and search; **Close manual** gives the width back. On
   the website it opens in a new browser tab. The links inside the manual to
   other pages of the project open only when you click them; the viewer
   itself never contacts the network (chapter 10).
10. **Image line**: the current image's name, field of view in cm, matrix,
   source kind (slices, multiframe, or radiograph), and voxel or pixel size in
   µm. The built-in phantom is named **Synthetic phantom** here, and while
   nothing of yours is open the line adds a reminder that it carries no
   patient data, that **open** loads your own scan, and that **help** opens
   the guide.
11. **Hint line** (right edge): a live reminder of the mouse and key bindings
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
- **Slice numbers count one way, everywhere.** Every slice ordinal on screen or in
  a saved PNG is the pane's own count, 1-based, with its direction printed beside
  the number: `AXIAL 622/801 S→I` means slice 622 of 801 counting from the
  superior (top) end; coronal counts P→A (back to front), sagittal R→L (patient
  right to left). The axial scouts in Pano, TMJ, Reslice and Region use the same
  count as the MPR axial pane, so a number read in one mode means the same slice
  in another. The slice-stack export is the one deliberate exception: its
  filenames carry the voxel index (chapter 7), and its `meta.json` states the
  mapping.
- **Double-clicking any slider resets it** (navigation sliders to the volume
  middle, parameters to their defaults).
- **The reading place carries between modes.** The axial level and the MPR
  crosshair are shared: MPR at axial slice 120 opens Pano, TMJ, Reslice and
  Region on slice 120, and MPR comes back at 120 with the crosshair where it
  was. The place belongs to the open volume and lives in this tab or window
  only; it is not kept across a relaunch.
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

In MPR, a strip under the four panes lists every annotation and measurement
on the current volume (chapter 6) together with **saved views**; it appears
once there is something to list and never covers an image. Press `V`, or the
**Save view** button in the axial pane's top-right corner, to save the
current view: all four pane cameras plus the display state
(window, render settings). One click on a saved view restores it exactly. A
view saved by an AI agent over MCP (chapter 9) carries an **agent** badge, so
your bookmarks and the agent's never mix.
Annotations and saved views persist per volume across sessions; they are
stored as small text sidecars on this machine, never inside the scan
(section 10.2).

## 3.5 Global keys

`N` / `P` next and previous volume · `1` to `9` and `0` select the tool ·
`R` reset orientation · `C` toggle plane lines · `O` toggle overlays ·
`V` save the current view · `Del` delete the selected annotation. The full
reference, including every mouse gesture, is chapter 12.

## 3.6 The image panes

Every slice pane, in every mode, keeps the same corners, in 12 px text on a
dark halo so it reads on bright bone as on air, with numbers in fixed-width
figures so they do not jitter while they change:

- **Top left**: the plane, in its colour (axial red, sagittal yellow, coronal
  green), and the slice as n/N with the direction of the count, for example
  `AXIAL 100/200 S→I`. No mouse hints sit in a pane; they are in the keys
  card and the hint line.
- **Bottom right**: the window the pane shows, width then level, for example
  `W 4000 L 1000`. It follows the presets, the sliders and a window drag. In
  Pano the pano's own readout follows auto-adjust.
- **Edge midpoints** (MPR): the patient-orientation letters, computed from the
  live camera.
- **Bottom centre** (MPR): the scale bar, a yellow bar of a round length (1,
  2 or 5 mm, 1, 2 or 5 cm and so on) with its length beside it. `O` hides it
  with the other overlays.
- **Bottom left** (MPR): the HU under the cursor.
- **Top right**: the pane's buttons.

In Pano, TMJ and Reslice the captions of the pano and of each section sit in a
strip above the image, never over it. Measurement labels stay inside the
image, on the same dark halo.

The pane that takes the mouse wheel carries a thin blue frame: the pane the
pointer is in, or the last one it was in. Nothing else about a pane changes
with the pointer.

The pane buttons show an icon only, 14 px, each with its standard meaning;
the keys card lists them with their names, and a screen reader reads the
name:

| Icon | Button | Where | What it does |
|---|---|---|---|
| Counter-clockwise arrow | **Reset view** | every MPR pane | Re-fit that pane's zoom and pan; orientation and window stay. On the 3D pane it re-homes the camera. |
| Left-right arrow | **Flip** | MPR slice panes | Mirror the pane's viewing direction; the letters follow. |
| Left arrow | **Orbit left** | 3D pane | Turn the render left; hold to keep turning. |
| Right arrow | **Orbit right** | 3D pane | Turn the render right; hold to keep turning. |
| Up arrow | **Orbit up** | 3D pane | Tip the render up; hold to keep turning. |
| Down arrow | **Orbit down** | 3D pane | Tip the render down; hold to keep turning. |
| Curved back arrow | **Undo erase** | 3D pane, eraser on | Undo the last eraser stroke. |
| Curved forward arrow | **Redo erase** | 3D pane, eraser on | Redo the stroke just undone. |

Three pane buttons keep their word beside the icon: **Save view** (axial
pane, `V`), **Eraser** and **Revert** (3D pane). Grid's **Reset view** sits in
its toolbar.
