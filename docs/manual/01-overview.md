# 1 · Overview

## What CBCTScope is

CBCTScope opens the CBCT exports already on your computer and reads them in
eight purpose-built modes. It is not an installed application with an icon: it
is a small local program you start once per reading session, and your web
browser is the screen. Nothing about it is online. There is no account, no
cloud, and no upload; the scan is read in place from the folder it is already
in, and it never leaves your machine.

Three ideas organize the whole program:

1. **Local-first.** Every pixel stays on this computer. The viewer works
   without a network connection, and by construction it cannot send a scan
   anywhere (chapter 10 details the mechanism).
2. **One instrument, eight reading modes.** The same opened volume can be read
   as orthogonal MPR slices with a 3D render, a multi-slice grid, a curved
   panoramic with cross-sections, axis-corrected TMJ sections, a freehand
   reslice, a virtual cephalogram, a density-grown region with airway
   analysis, or a stitched pair of volumes. Switching modes never touches the
   data; each mode is a different camera on the same volume.
3. **The agent moves the camera; the human reads.** An AI assistant can drive
   the viewer through a built-in MCP server: open a scan, switch modes, set
   the window, step through slices, take snapshots. It can do nothing else.
   No part of the software, agent-driven or not, produces findings or
   interpretations (chapter 9).

## Volumes and radiographs

CBCTScope opens two classes of image:

- **CBCT volumes**: uncompressed DICOM exports, as a slice-series folder, a
  DICOMDIR tree, a multiframe file, or a single slice of a series. Volumes get
  the eight reading modes.
- **2D radiographs**: single uncompressed 16-bit DICOM images of modality PX,
  DX, CR, or IO (panoramic, digital and computed radiography, intraoral). A
  radiograph gets a dedicated single-image view with window, gamma, invert,
  zoom, pan, and fit. The volumetric modes do not apply. This exists so
  multi-reader studies can read both image classes in one instrument under
  identical display settings.

## The demo phantom

A synthetic phantom is built into the program: jaws, dental arches, teeth with
enamel and pulp, a metal crown, airway, sinuses, and TMJ condyles, all
procedurally generated. It loads the moment the viewer starts, so every part
of this manual can be tried with zero patient data. When the program is
started in demo mode it additionally never remembers a previously opened scan
(section 2.4).
