# 3 · The interface

The whole program is one screen: a header across the top, the active reading
mode filling the middle, and a status line along the bottom. There are no
dialogs to dismiss and no hidden panels; every control is visible at full
contrast at all times, by design.

## 3.1 The header

![The header on the built-in phantom, numbered left to right: the name and what it is, the version button, the research-use badge, the mode tabs, the volume list, Open, Export, Snapshot, Keys, Help, and Agent](../media/manual/header.webp)

The header is one row on a wide screen and wraps onto a second row, whole
groups at a time, when the window is narrower than its controls. From left to
right:

1. **CBCTScope**, with what it is under the name:
   **CBCT and radiograph viewer**. Beside it, the **version button** (for example `v2.0.0`).
   Clicking it opens a short panel naming the software, its version, its
   author, its research-use status, and a link to the source code repository;
   Escape or a click outside closes it. Quote the version from here when
   reporting a problem or citing the software.
2. **Research use only. Not a medical device.** (the desktop app and the local
   app say **Not for diagnosis.**) A permanent badge, not a dismissible
   banner. It states what the program is; see "Intended use" on the manual's
   front page.
3. **Mode tabs**: MPR, Grid, Pano, TMJ, Reslice, Ceph, Region, Stitch, drawn as
   one group; the selected mode is the solid blue tab. One click switches the
   reading mode; the loaded volume is untouched. Chapter 8 introduces the
   modes. A 2D radiograph replaces the tabs with a single **2D radiograph**
   label, since the volume modes have nothing to act on.
4. **Volume list**: a dropdown listing every image the viewer currently
   serves, grouped as Stitched (session stitches from the Stitch mode),
   Opened (your export, under its folder name), and Built in (the phantom).
   Each entry shows its field of view, matrix, and acquisition details where
   present. The built-in phantom is the **Geometric test phantom**: a
   procedural head of simple shapes for trying the controls, not a jaw. The
   previous and next buttons on either side of the list, or the `N` and `P`
   keys, cycle through it.
5. **Open**: the source menu for opening and closing your own exports
   (chapter 4). It always reads Open; the opened folder's name is in the
   volume list.
6. **Export**: the volume export menu (chapter 7). Shown for volumes, not for
   2D radiographs, whose slice stacks and surface meshes have no meaning.
7. **Snapshot**: saves what the current mode shows as a PNG (chapter 7). This
   one button serves every mode, including 2D radiographs.
8. **Keys**: the keyboard reference for the current mode, in words (chapter
   12).
9. **Help**: the reading guide for the current mode (chapter 8), this manual,
   and the **Source code repository**. The viewer serves the manual itself, so
   it needs no network. In the local app and the desktop app it opens in a
   drawer at the right edge that narrows the viewer and covers no control,
   with the manual's contents and search; **Close manual** gives the width
   back. On the website it opens in a new browser tab. The links inside the
   manual to other pages of the project open only when you click them; the
   viewer itself never contacts the network (chapter 10).
10. **Agent** (the website and the desktop app): opens the strip of the
    opt-in navigation agent under the viewer (section 9.6). It reads **Agent
    on** while the agent is on and carries no status otherwise; the strip names
    the provider and holds **Switch off**.
11. **Download the desktop app** (the website in a plain browser only; it
    reads **Desktop app** on a narrower window): the latest release, with the
    installers for macOS and Windows (section 2.6).

Every menu and popover closes with Escape or a click anywhere outside it,
the image included; the arrow keys move through a menu's entries. Keyboard
focus shows as a blue ring around the control.

## 3.2 The status line

The line along the bottom of the window holds what describes the image and
what teaches the mouse, so the header keeps to controls:

- **Image facts**: the current image's name (the phantom is named once, in
  the volume list), field of view in cm, matrix, source kind (slices,
  multiframe, or radiograph), and voxel or pixel size in µm.
- **First-run line**: while the phantom is on screen and nothing of yours is
  open, it says "Built in, no patient data. Your scan is read in this tab and
  never uploaded." (the desktop app and the local app say "on this computer")
  and links **See CBCTScope on a real scan** to stills of a real,
  consented CBCT (bone only) on the project page. It leaves by itself once you
  open an export.
- **Gesture legend** (right): a live reminder of the mouse bindings for the
  current mode, active tool and image class, ending with "Double-click a
  slider to reset it." On a narrow window it is cut short; the full text is in
  the mode's guide and in chapter 12.

Below 768 px wide (a phone, or a very narrow window) a notice above the
viewer says that CBCTScope reads scans in a desktop browser and that here you
can look at the built-in phantom.

## 3.3 The mode area

Each reading mode fills the area between the header and the status line with
its own panes and its own control rail; the per-mode guides (chapters 8.1 to
8.8) document them control by control, including each mode's own mouse
gestures. Conventions that hold across modes:

- **One Snapshot button** lives in the header next to Export, in the same
  place no matter which mode is open. It saves a PNG of what the current
  mode shows, exactly as displayed, to your Downloads folder; each mode
  supplies its own composition behind that one button.
- **Selected means solid blue.** A selected mode tab, tool, window preset or
  3D style is a solid blue chip with dark text; nothing else is drawn in that
  blue.
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
- **Disabled controls stay fully readable** and their tooltip says why they
  are unavailable; nothing dims, hides, or unmounts. The one dimming in the
  program is the backdrop behind an open dialogue, whose controls are the only
  ones that answer until it closes; Tab stays inside the dialogue.
- **Pane dividers** between a mode's panes drag to resize and double-click
  back to the default split.
- Double-click is otherwise a per-mode verb: in MPR it maximizes a pane and
  restores the 2 by 2 layout on the second double-click; in Pano and Reslice
  it finishes the arch or path being drawn; on a slider or crop handle it
  resets that control.

## 3.4 Window controls

The density window (chapter 5) is set once and applies across modes: presets,
a histogram with draggable black and white cut lines, Center and Width
sliders, a Gamma slider, and an Invert checkbox. Until a volume has loaded,
the sliders show no number.

## 3.5 The objects panel and saved views

In MPR, a side panel lists every annotation and measurement on the current
volume (chapter 6) together with **saved views**. Press `V`, or use the panel,
to save the current view: all four pane cameras plus the display state
(window, render settings). One click on a saved view restores it exactly. A
view saved by an AI agent over MCP (chapter 9) carries an **agent** badge, so
your bookmarks and the agent's never mix.
Annotations and saved views persist per volume across sessions; they are
stored as small text sidecars on this machine, never inside the scan
(section 10.2).

## 3.6 Global keys

`N` / `P` next and previous volume · `1` to `9` and `0` select the tool ·
`R` reset orientation · `C` toggle plane lines · `O` toggle overlays ·
`V` save the current view · `Del` delete the selected annotation. The full
reference, including every mouse gesture, is chapter 12.
