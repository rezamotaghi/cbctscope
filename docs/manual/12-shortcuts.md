# 12 · Keyboard and mouse reference

## Keys, anywhere

| Key | Action |
|---|---|
| `N` / `P` | Next / previous volume |
| `1` … `9`, `0` | Select tool: Crosshairs, Pan, Length, Angle, Arrow, Text, Rect ROI, Ellipse ROI, Freehand, 3D ROI (MPR only) |
| `W` | Select the W/L (window/level) tool (MPR only) |
| `R` | Reset orientation (MPR; radiograph view: fit) |
| `C` | Toggle plane lines (MPR only) |
| `O` | Toggle overlays (MPR only) |
| `V` | Save the current view (MPR only) |
| `Del` / `Backspace` | Delete the selected annotation |

Keys are ignored while you are typing in a text field. They also answer only
when no Cmd, Ctrl or Alt is held: with one of those held, the key goes to the
browser or the desktop app's menu, in every mode: Cmd-O opens, Cmd-W closes
a window and Cmd-C copies. In a browser, Cmd-R reloads the page; the desktop
app has no reload. The tool and overlay
keys act only in the MPR room, so a stray keypress in another mode cannot
change state you cannot see there. The header's **Keys** button shows the
keys of the current mode and, under **Mouse**, every mouse gesture of that mode,
pane by pane; the status line shows three of them and points to the card. Double-clicking any slider resets it: navigation
sliders return to the volume middle, parameter sliders to their defaults,
and the histogram's cut lines to the automatic window.

## Mouse, MPR slice panes

| Gesture | Action |
|---|---|
| Wheel | Scroll slices in the hovered pane |
| Left-click / left-drag | The active tool. With Crosshairs, a left-click places the crosshairs and a left-drag pans |
| Shift + left click | Select an annotation |
| Right-drag | Rotate the section about the crosshair center (all three planes stay orthogonal; a live chip shows degrees) |
| Shift + right-drag, or right+left chord drag | Zoom |
| Middle-drag | Pan |
| Double-click | Maximize / restore the pane |

## Mouse, 3D pane

| Gesture | Action |
|---|---|
| Left-drag | Rotate the render |
| Middle-drag | Pan |
| Right-drag | Cut progressively into the render |
| Right+left chord drag | Zoom |
| Wheel | Zoom |
| Left-drag, Eraser on | Erase what you touch |
| Double-click | Maximize / restore the pane |

## Mouse, 2D radiograph view

| Gesture | Action |
|---|---|
| Wheel | Zoom, centered on the cursor |
| Left-drag | Pan |
| Double-click | Fit to window |

Modes beyond MPR add their own gestures on their own canvases (the arch
editor's stroke and points in Pano, the line in Reslice, the seed click in
Region, and so on); the Keys card lists them for the mode on screen, and each
mode's guide in chapter 8 documents them where they are used.
