# AI-agent control over MCP

CBCTScope ships a [Model Context Protocol](https://modelcontextprotocol.io) server so any MCP-capable agent host (Claude Code, Claude Desktop, and others) can drive the viewer.

## The fence

Every tool is clinical **navigation** or **visualization**. This is a design constraint, not a disclaimer:

- No tool returns findings, interpretations, or diagnoses. `snapshot` returns pixels; reading them is the human's job.
- No tool executes agent-supplied code. The verb set is closed; the viewer rejects unknown verbs.
- Nothing the agent does causes a scan to leave the machine. `open_scan` reads a local path in place; results carry display labels and technical geometry only.

The moment a tool returned a finding, this software would be functioning as a diagnostic device. It does not and will not.

## Architecture

```
agent host ──stdio──> mcp/server.mjs ──HTTP──> viewer server ──SSE──> browser UI
                                                (localhost:3810)        executes and
                                                                        answers back
```

The MCP server is a thin proxy: it forwards each verb to `POST /api/agent/command`, the viewer server relays it over a server-sent-events channel to the open browser tab, the UI executes it against live state and posts the result back. Both the viewer and the browser tab must be running; the MCP server reports a clear error otherwise.

## Setup

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

## Verbs

| Verb | Arguments | Effect |
|---|---|---|
| `open_scan` | `path` | Point the viewer at a local export (folder, DICOMDIR, multiframe file, or one slice of a series). Returns the volume catalog. |
| `list_volumes` | none | Volume ids plus geometry: dimensions, voxel spacing, field of view. |
| `select_volume` | `id` | Display that volume. |
| `set_view_mode` | `mode` | One of `mpr`, `grid`, `pano`, `tmj`, `reslice`, `ceph`, `region`, `stitch`. |
| `set_window_level` | `preset` or `center` + `width`, optional `invert` | HU display window. Presets: `Auto`, `Bone`, `Teeth`, `Soft`. |
| `navigate_slice` | `pane`, `index` or `delta` | Move an MPR pane (`axial`, `sagittal`, `coronal`) to a slice. |
| `snapshot` | none | PNG of the current viewing area, all visible panes. |
| `reset_view` | optional `full` | Cameras back to orthogonal; `full` also resets window, inversion, and gamma. |

Mutating verbs return the resulting viewer state (current volume, view mode, window), so the agent always knows where it stands without a follow-up call.

## A note on trust

The agent can only do what a hand on the mouse could do: open, look, move, capture. Treat agent-written summaries of what it "saw" with the same skepticism you would apply to any unverified observer; the authoritative read is yours, on your screen.
