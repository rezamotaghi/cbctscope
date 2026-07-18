# Reading-room guides

One guide per reading mode, written from clinical practice: not a feature list, but how a
reader moves through a volume in that mode, which controls serve which question, and where
the mode stops.

| Mode | The clinical question it answers |
|---|---|
| [MPR](mpr.md) | What is here, in three dimensions: localize, follow across planes, measure in true mm, and present it. |
| [Grid](grid.md) | Show this whole region slice by slice at a glance, at a chosen spacing and any angle. |
| [Pano](pano.md) | Survey the dental arch and jaws in one panoramic layout, then see any point in cross-section. |
| [TMJ](tmj.md) | What does each condyle look like in sections corrected to its own axis, and how do the sides compare? |
| [Reslice](reslice.md) | Cut a fresh slice stack along any line or curve the fixed planes do not give. |
| [Ceph](ceph.md) | An overall skeletal impression in a familiar projected radiographic format, reproducible off the same scan. |
| [Region](region.md) | How large is this connected region by density, and where is it narrowest (the airway read)? |
| [Stitch](stitch.md) | Align and merge two scans of the same subject into one volume when coverage spans both. |

## The fence

Every mode in CBCTScope, and every agent verb over MCP, is clinical navigation or
visualization. The software moves the camera, reformats the volume, and reports geometry
and raw density numbers. It does not produce findings, interpretations, or diagnoses, in
the UI or over MCP. Density statistics are uncalibrated by nature (CBCT HU is approximate),
segmentations and traces are reader-drawn, and reformats show only what their geometry
samples. The authoritative read is the reader's, on their own screen. CBCTScope is for
research use only and is not a medical device; do not use it for clinical decision-making.
