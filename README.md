# CBCTScope

**A local-first CBCT viewer with native AI-agent control.**

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21431452.svg)](https://doi.org/10.5281/zenodo.21431452)

![An AI agent driving CBCTScope over MCP on the built-in synthetic phantom: window presets, slice navigation, multi-slice grid, curved panoramic with cross-sections](docs/media/cbctscope-demo.gif)

*Above: an agent driving the viewer in demo mode. Window preset, slice
navigation, the multi-slice grid, and the mode switches are MCP verbs sent by
the agent; the arch proposal and pano enhancement are the viewer's own
one-click tools. Each frame is a capture of the full viewer window as the
commands land. The volume is the built-in synthetic phantom, so no patient
data can appear, by construction.*

### The interface at a glance

| MPR + 3D | Multi-slice grid | Curved panoramic |
|---|---|---|
| [![MPR: axial, sagittal, coronal and 3D render with crosshairs, HU windowing, slab and MIP controls](docs/media/thumb-mpr.png)](docs/media/thumb-mpr.png) | [![Grid: parallel axial slices with a sagittal scout, spacing and thickness controls](docs/media/thumb-grid.png)](docs/media/thumb-grid.png) | [![Pano: arch spline on the axial, curved panoramic, perpendicular cross-sections](docs/media/thumb-pano.png)](docs/media/thumb-pano.png) |

Click any thumbnail for full resolution; the per-mode reading guides are in
[docs/reading-modes](docs/reading-modes/).

Open any local CBCT export and read it in eight purpose-built modes: MPR, multi-slice grid, curved panoramic, TMJ, freehand reslice, virtual cephalogram, region growing with airway analysis, and two-volume stitching. Your scan never leaves your computer. An AI agent can drive the whole viewer through a built-in [MCP](https://modelcontextprotocol.io) server: it opens scans, switches reading modes, sets the window, moves through slices, and takes snapshots. The agent moves the camera. The human reads.

> **Research use only. Not a medical device.** CBCTScope visualizes and navigates volumes. It never produces findings, measurements-as-conclusions, or diagnoses, in the UI or over MCP. Do not use it for clinical decision-making.

## Why this exists

To our knowledge, CBCTScope is the first CBCT viewer with native AI-agent control. Neighboring projects exist and deserve credit: [dicom-mcp](https://github.com/ChristianHinge/dicom-mcp) and the [Flux Inc. DICOM MCP server](https://github.com/fluxinc/dicom-mcp-server) query PACS metadata over MCP, [dicom-viewer-mcp-app](https://github.com/ThalesMMS/dicom-viewer-mcp-app) prototypes MCP-driven DICOM slice rendering, and [mcp-slicer](https://github.com/zhaoyouj/mcp-slicer) drives 3D Slicer through raw Python execution. None of them is a purpose-built CBCT reading environment, and none constrains the agent to a small set of clinical navigation verbs. CBCTScope does both: a dental and maxillofacial reading workflow, plus an agent surface that is deliberately navigation-only.

## Privacy stance

- Scans are read **in place** from the folder you pick. Nothing is copied or uploaded anywhere.
- There is no hosted instance and there never will be one. The server binds to 127.0.0.1 and rejects any request whose Host or Origin is not loopback, so neither another device on your network nor a hostile web page in another tab (DNS rebinding, cross-site POSTs) can reach it.
- No absolute file paths reach the browser or the agent transcript. The UI shows a display label derived from the last folder and file names of what you opened (so name your export folders accordingly) plus technical geometry only.
- The only writes are an app-data folder (`~/.cbctscope`) holding your annotation sidecars (labels, world-mm coordinates, HU statistics) and a pointer to the last source you opened, so the viewer can restore it. Never pixels. Demo mode writes neither.

## Quickstart

Requires Node.js 22+.

```sh
npm install
npm run demo     # starts the viewer at http://localhost:3810
```

Open http://localhost:3810. A built-in **synthetic phantom** loads immediately, so the full viewer works with zero patient data. Demo mode is also a privacy guarantee: it never restores or remembers a previously opened scan, so a recording or screenshot session can never accidentally surface a real case. The phantom: jaws, dental arches, teeth with enamel and pulp, a metal crown, airway, sinuses, and TMJ condyles, all procedurally generated.

To read a real scan, click **open** in the header and pick a CBCT export: a folder, a DICOMDIR tree, a multiframe DICOM file, or one slice of a series (the whole series opens). Uncompressed exports are supported; the native file chooser is macOS-only, other platforms can `POST /api/cbct/source` with a path.

## Reading modes

| Mode | What it does |
|---|---|
| MPR | Orthogonal slices with crosshairs, oblique rotation, slab/MIP, measurements, 3D render with adjustable styles, clipping, and a render eraser |
| Grid | Many parallel slices of a rotatable stack on one screen |
| Pano | Draw the dental arch once, get a curved panoramic plus cross-sections, nerve tracing, and focal-trough control |
| TMJ | Both condyles side by side in axis-corrected sections |
| Reslice | A fresh slice stack along any drawn line or curve |
| Ceph | A virtual cephalogram, the volume projected flat like a film |
| Region | Region growing with HU presets, volume and density stats, airway analysis |
| Stitch | Rigid registration and fusion of two volumes of the same subject |

Per-mode reading guides live in [docs/reading-modes/](docs/reading-modes/).

### 2D radiographs

The viewer also opens single 2D radiographs (DICOM modality PX, DX, CR, or IO:
panoramic, digital and computed radiography, intraoral), uncompressed 16-bit files, the
same constraint as volumes. A radiograph gets a dedicated single-image view: window,
gamma, invert, cursor-centered zoom, pan, fit. Gray values are display-normalized to a
12-bit scale at load (radiographs carry no HU calibration), and MONOCHROME1 files are
flipped so bright is always radiopaque. The volumetric reading modes apply to volumes
only. This exists so multi-reader studies can read both image classes in one instrument
under identical display settings.

### Exporting

The volume header has an **export** menu with three client-side formats: a PNG slice
stack (a zip of one PNG per slice at the displayed window, plus a geometry `meta.json`),
a NIfTI volume (`.nii.gz`, HU values, for Slicer, ITK-SNAP, nibabel, MONAI), and an STL
surface mesh (marching cubes at a chosen HU threshold, honoring the 3D crop box, for
printing or CAD). Everything is computed in the browser and saved to this machine's
Downloads: nothing is uploaded, the same local-first constraint as reading.

## AI-agent control (MCP)

Start the viewer, open it in a browser, then register the MCP server with your agent host:

```json
{
  "mcpServers": {
    "cbctscope": {
      "command": "node",
      "args": ["/absolute/path/to/cbctscope/mcp/server.mjs"]
    }
  }
}
```

The agent gets eight verbs, all navigation or visualization: `open_scan`, `list_volumes`, `select_volume`, `set_view_mode`, `set_window_level`, `navigate_slice`, `snapshot`, `reset_view`. There is no code execution and no tool that returns an interpretation. Details and the full contract: [docs/mcp.md](docs/mcp.md).

CBCTScope is one of a pair of agent-native instruments built on the same principle (bounded verbs for the agent, commit rights for the human); the other is [Quoin](https://github.com/rezamotaghi/quoin), a text editor for macOS where any agent may edit the buffer and only the human holds the save button. Both at [rezamotaghi.com](https://rezamotaghi.com).

## Development

```sh
npm run dev          # dev server on :3810
npm run typecheck    # tsc
npm run lint         # eslint
npm test             # vitest: arch-spline reformat, NCC registration, region growing, HU windowing, phantom
npm run build        # production build
```

Built on [Cornerstone3D](https://www.cornerstonejs.org/) and Next.js. All rendering styles, reading workflows, and reconstruction math are original, from-scratch implementations informed by clinical reading practice; the project contains no vendor code, assets, or documentation.

## Author

Built by [Dr. Reza Motaghi](https://rezamotaghi.com/research), oral and maxillofacial radiologist. If you use CBCTScope in research, please cite it (see [CITATION.cff](CITATION.cff)).

## License

[AGPL-3.0-or-later](LICENSE). Free to use, study, and modify. If you build a product or
service on this code, its source must be open under the same terms.

For uses the AGPL does not fit (closed-source products, commercial integration), a
separate commercial license is available: reach me through the contact page at
[rezamotaghi.com/contact](https://rezamotaghi.com/contact).
