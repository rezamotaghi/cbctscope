# 9 · AI-agent control

## 9.1 What it is

CBCTScope ships a server for the
[Model Context Protocol](https://modelcontextprotocol.io) (MCP), the standard
by which AI assistants operate external tools. Any MCP-capable agent host
(Claude Code, Claude Desktop, and others) can drive the viewer: open a scan,
switch reading modes, set the window, step through slices, restore a saved
view, take snapshots to look at. In practice you can tell an assistant "open
the case in this folder, teeth window, pano mode" and watch the viewer follow.

The agent can only do what a hand on the mouse could do: open, look, move,
bookmark, capture. This is a design constraint, not a disclaimer:

- No verb returns findings, interpretations, or diagnoses. `snapshot` returns
  pixels with a one-line caption of the viewer state; reading the pixels is the
  human's job.
- No verb executes agent-supplied code. The verb set is closed; unknown verbs
  are rejected.
- Nothing the agent does can cause a scan to leave the machine. When the agent
  asks you to pick a scan, the native dialog opens on your machine and the
  agent receives the display label, never the path.
- A saved view is a presentation, not a finding. A view the agent saves shows
  an **agent** badge in the objects panel (section 3.4), so you never mistake
  it for your own bookmark.

> **Caution.** Treat agent-written summaries of what it "saw" with the same
> skepticism you would apply to any unverified observer. The authoritative
> read is yours, on your screen.

## 9.2 Setup

Start the viewer and open it in a browser; both must be running. Then connect
your agent host in one of three ways.

**By path.** Register the MCP server in the host's configuration:

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

If the viewer runs on a non-default address, set the `CBCTSCOPE_URL`
environment variable (default `http://localhost:3810`).

**One-click bundle (Claude Desktop).** Every release carries a file named
`cbctscope-<version>.mcpb`, an MCP Bundle of this server. Download it from the
release page, open it with Claude Desktop, confirm the install, and set the
viewer URL in the extension's settings if yours is not the default. The bundle
installs the agent half only; the viewer itself still runs from the repository
(chapter 2).

**Agent Skill.** The repository ships `skills/cbctscope-reading/SKILL.md`, a
short instruction file in the open Agent Skills format that teaches a host the
verbs, the fence, and the reading choreographies below. Copy or link the folder
into your host's skills directory.

## 9.3 The verbs

| Verb | Arguments | Effect |
|---|---|---|
| `open_scan` | `path` | Point the viewer at a local export. Returns the volume catalog. |
| `pick_scan` | optional `kind` (`folder` or `file`) | Open the native file dialog on your machine so you choose. The agent receives the label and catalog, never the path; cancel is a normal outcome. |
| `list_volumes` | none | Volume ids plus geometry: dimensions, voxel spacing, field of view. |
| `select_volume` | `id` | Display that volume. |
| `viewer_state` | none | What is on screen: volume, mode, window, slice positions in the pane count, the grid window or the pano arch position, 3D style, saved views. |
| `set_view_mode` | `mode` | One of the eight reading modes, by name. |
| `set_window_level` | `preset` or `center` + `width`, optional `invert` | The density window. |
| `set_3d_style` | `style` | The 3D pane's rendering style (MPR), by its key: `style:shaded`, `style:shiny`, `style:surface`, `style:soft-tissue`, `style:mip`, `style:xray`, `style:xray-shaded`, `style:bw-xray`, `cbct:bone-teeth`, `cbct:teeth`, `cbct:translucent`. |
| `navigate_slice` | `pane`, `index` or `delta` | Move to a slice. `index` is 0-based in the pane's own count (the label `AXIAL 622/801 S→I` is index 621; axial counts from the superior end, coronal from posterior, sagittal from patient right); `delta` moves toward the label's "to" end. In MPR it moves that pane; in grid it moves the window centre (`pane` switches the plane, `delta` steps whole grid spacings); in pano `pane: "axial"` moves the axial editor slice. |
| `navigate_arch` | `position_mm` or `delta_mm` | Pano: center the cross-sections along the drawn arch, in mm from the patient-right end. The arch is yours to draw. |
| `list_views` | none | Saved views of the selected volume (MPR): id, name, and who saved it. |
| `goto_view` | `view` (id or exact name) | Restore that saved view exactly. |
| `save_view` | `name` | Bookmark the current presentation, marked as agent-saved. |
| `snapshot` | none | PNG of the current viewing area, all visible panes, with the state caption. |
| `reset_view` | optional `full` | Cameras back to orthogonal; `full` also resets window, inversion, gamma. |

Every verb returns the resulting viewer state, so the agent always knows where
it stands. When the selected image is a 2D radiograph, the volumetric verbs
(`set_view_mode`, `set_3d_style`, the HU presets) answer with a clear error
instead of acting; numeric windowing, `snapshot`, and `reset_view` work
unchanged. A verb the current reading mode cannot serve (a slice in ceph mode,
a saved view outside MPR) answers with a clear error rather than waiting.

## 9.4 Resources and prompts

Some hosts let you attach context to a conversation instead of asking the
agent to call a tool. The server offers the same state as read-only
**resources**: `cbctscope://volumes` (the catalog), `cbctscope://state` (what
is on screen), `cbctscope://views` (the saved views), and
`cbctscope://volume/{id}` (one volume's geometry).

It also offers four **prompts**, ready-made navigation choreographies distilled
from the reading guides in chapter 8: `mpr-survey` (walk every MPR pane at a
bone window and snapshot at evenly spaced stops), `pano-survey` (step the
cross-sections along the arch you drew), `tmj-read` (set up the TMJ mode and
record both condyle rows), and `replay-views` (restore every saved view in order
and snapshot each, so you can verify a set of bookmarked presentations). Each
prompt starts with the fence and ends by handing the snapshots to you.

## 9.5 One viewer at a time

The newest open viewer tab holds the agent connection. Opening a second tab
evicts the first, which shows a banner and keeps working by hand; agent
commands go to exactly one tab, never race between two.

The full technical contract, including the architecture and the live check
(`npm run mcp:smoke`), lives in [docs/mcp.md](../mcp.md).
