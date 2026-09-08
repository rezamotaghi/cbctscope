# AI-agent control over MCP

CBCTScope ships a [Model Context Protocol](https://modelcontextprotocol.io) server so any MCP-capable agent host (Claude Code, Claude Desktop, and others) can drive the viewer.

## The fence

Every tool is clinical **navigation** or **visualization**. This is a design constraint, not a disclaimer:

- No tool returns findings, interpretations, or diagnoses. `snapshot` returns pixels with a one-line caption of the viewer state (volume, mode, window, slice numbers); reading the pixels is the human's job.
- No tool executes agent-supplied code. The verb set is closed; the viewer rejects unknown verbs.
- Nothing the agent does causes a scan to leave the machine. `open_scan` reads a local path in place; `pick_scan` lets the human choose in the native dialog and returns the display label, never the path; results carry display labels and technical geometry only.
- A saved view is a presentation (cameras, window, render settings), not a finding. A view the agent saves is marked as agent-saved in the sidecar and shows an **agent** badge in the objects panel, so the reader never mistakes it for their own bookmark.
- Resources are read-only mirrors of the same state. Prompts are navigation choreographies distilled from the reading guides; each one ends by handing the snapshots to the reader.

The moment a tool returned a finding, this software would be functioning as a diagnostic device. It does not and will not.

## Architecture

```
agent host ──stdio──> mcp/server.mjs ──HTTP──> viewer server ──SSE──> browser UI
                                                (localhost:3810)        executes and
                                                                        answers back
```

The MCP server is a thin proxy: it forwards each verb to `POST /api/agent/command`, the viewer server relays it over a server-sent-events channel to the open browser tab, the UI executes it against live state and posts the result back. Verbs that belong to one reading mode (slices, arch position, saved views) are answered by the mounted mode component; a verb the current mode cannot serve fails fast with a clear error instead of hanging. Both the viewer and the browser tab must be running; the MCP server reports a clear error otherwise.

## Setup

Three ways to connect a host, from the most manual to the least:

1. **Register the server by path** in the host's MCP configuration:

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

   Set `CBCTSCOPE_URL` if the viewer runs on a non-default port (default `http://localhost:3810`).

2. **One-click bundle for Claude Desktop.** Each release carries `cbctscope-<version>.mcpb`, an [MCP Bundle](https://github.com/modelcontextprotocol/mcpb) of this server with its dependencies. Open the file with Claude Desktop, confirm the install, and set the viewer URL in the extension's settings if it is not the default. The bundle installs the MCP half only: the viewer itself still runs from the repository (see the README). Build it locally with `npm run mcpb`.

3. **Agent Skill.** `skills/cbctscope-reading/SKILL.md` is an [Agent Skill](https://agentskills.io) that teaches a host the verbs, the fence, and the reading choreographies. Copy or symlink the folder into the host's skills directory.

## Verbs

| Verb | Arguments | Effect |
|---|---|---|
| `open_scan` | `path` | Point the viewer at a local export (folder, DICOMDIR, multiframe file, one slice of a series, or a single 2D radiograph file). Returns the volume catalog. |
| `pick_scan` | optional `kind`: `folder` (default) or `file` | Open the native file dialog on the viewer's machine so the human chooses. Returns the label and catalog, never the path; `{ canceled: true }` is a normal outcome. Waits while the dialog is open (up to five minutes). |
| `list_volumes` | none | Volume ids plus geometry: dimensions, voxel spacing, field of view. |
| `select_volume` | `id` | Display that volume. |
| `viewer_state` | none | What is on screen: volume, mode, window, inversion, slice positions in the pane count with direction (MPR), the grid window or the pano arch position, 3D style, saved views. |
| `set_view_mode` | `mode` | One of `mpr`, `grid`, `pano`, `tmj`, `reslice`, `ceph`, `region`, `stitch`. |
| `set_window_level` | `preset` or `center` + `width`, optional `invert` | HU display window. Presets: `Auto`, `Bone`, `Teeth`, `Soft`. |
| `set_3d_style` | `style` | The 3D pane's rendering style (MPR): `style:shaded`, `style:shiny`, `style:surface`, `style:soft-tissue`, `style:mip`, `style:xray`, `style:xray-shaded`, `style:bw-xray`, `cbct:bone-teeth`, `cbct:teeth`, `cbct:translucent`. Each loads its own default threshold. |
| `navigate_slice` | `pane`, `index` or `delta` | Move to a slice in the pane's own count: 0-based, counting the way the label does (axial superior→inferior, coronal posterior→anterior, sagittal right→left), so `AXIAL 622/801 S→I` is `index: 621`; a positive `delta` moves toward the label's "to" end. **MPR**: moves that pane. **Grid**: moves the window centre along the grid's plane; `pane` switches the plane; `delta` steps whole grid spacings. **Pano**: `pane: "axial"` moves the axial editor slice. Other modes answer with a clear error. |
| `navigate_arch` | `position_mm` or `delta_mm` | Pano: center the cross-sections at a position along the drawn arch, in mm from the patient-right end (the arc ruler). Needs an arch; the human draws it. |
| `list_views` | none | Saved views of the selected volume (MPR): id, name, and who saved it (`reader` or `agent`). |
| `goto_view` | `view` (id or exact name) | Restore that saved view: cameras, window, render settings. |
| `save_view` | `name` | Bookmark the current presentation, marked as agent-saved. Name a location or a task, never a finding. |
| `snapshot` | none | PNG of the current viewing area, all visible panes, plus the one-line state caption. |
| `reset_view` | optional `full` | Cameras back to orthogonal; `full` also resets window, inversion, and gamma. |

Every verb returns the resulting viewer state as text and as structured content, so the agent always knows where it stands without a follow-up call. Every tool declares its annotations (read-only or not, never destructive, never open-world) and an output schema, so a host can show what a verb does before running it.

When the selected image is a 2D radiograph (catalog `kind: "xray"`), the volumetric
verbs answer with a clear error instead of acting: `set_view_mode` (all modes are
volumetric), `set_3d_style`, and the HU-based window presets (`Bone`, `Teeth`, `Soft`; a
radiograph's gray values are display-normalized 0-4095, not HU). `set_window_level` with
`center`/`width`/`invert`, `snapshot`, and `reset_view` work unchanged.

## Resources

Read-only views of the same state, for hosts that let the user attach context instead of calling a tool:

| URI | Content |
|---|---|
| `cbctscope://volumes` | The volume catalog (same as `list_volumes`). |
| `cbctscope://state` | The viewer state (same as `viewer_state`). |
| `cbctscope://views` | Saved views of the selected volume (same as `list_views`). |
| `cbctscope://volume/{id}` | Geometry and default window of one volume; the template lists every current volume. |

## Prompts

Navigation choreographies a host can offer as ready-made instructions. Each starts with the fence and ends with the snapshots handed to the reader; none asks the agent to describe what it sees.

| Prompt | Arguments | Choreography |
|---|---|---|
| `mpr-survey` | optional `stops` (default 5), `preset` (default Bone) | Reset, window, walk each MPR pane through its extent at evenly spaced stops, snapshot at each, finish orthogonal. From the MPR guide. |
| `pano-survey` | optional `step_mm` (default 10) | Pano mode at a teeth window; if no arch is drawn, ask the reader to draw it; then step the cross-sections along the arch, snapshot at each stop. From the Pano guide. |
| `tmj-read` | none | TMJ mode at a bone window; ask the reader to draw the condylar axes; snapshot both rows. From the TMJ guide. |
| `replay-views` | none | Restore every saved view in order and snapshot each, so a reader can verify a set of bookmarked presentations. |

## One viewer at a time

The command bus follows a single-viewer contract: the newest open viewer tab holds the
agent connection. Opening a second tab evicts the first, which shows a banner and keeps
working by hand; agent commands always go to exactly one tab, never race between two.

## Checking the surface

`npm run mcp:smoke` (with the demo viewer running and a browser tab open) spawns the server the way a host does and walks every tool, resource, and prompt on the phantom, failing on the first wrong answer. `npm run mcp:smoke -- --pick` also opens the native dialog.

## A note on trust

The agent can only do what a hand on the mouse could do: open, look, move, bookmark, capture. Treat agent-written summaries of what it "saw" with the same skepticism you would apply to any unverified observer; the authoritative read is yours, on your screen.
