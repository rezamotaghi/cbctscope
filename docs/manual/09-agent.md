# 9 · AI-agent control

## 9.1 What it is

CBCTScope ships a server for the
[Model Context Protocol](https://modelcontextprotocol.io) (MCP), the standard
by which AI assistants operate external tools. Any MCP-capable agent host
(Claude Code, Claude Desktop, and others) can drive the viewer: open a scan,
switch reading modes, set the window, step through slices, take snapshots to
look at. In practice you can tell an assistant "open the case in this folder,
teeth window, pano mode" and watch the viewer follow.

The agent can only do what a hand on the mouse could do: open, look, move,
capture. This is a design constraint, not a disclaimer:

- No verb returns findings, interpretations, or diagnoses. `snapshot` returns
  pixels; reading them is the human's job.
- No verb executes agent-supplied code. The verb set is closed; unknown verbs
  are rejected.
- Nothing the agent does can cause a scan to leave the machine.

> **Caution.** Treat agent-written summaries of what it "saw" with the same
> skepticism you would apply to any unverified observer. The authoritative
> read is yours, on your screen.

## 9.2 Setup

Start the viewer and open it in a browser; both must be running. Then register
the MCP server with your agent host:

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

## 9.3 The verbs

| Verb | Arguments | Effect |
|---|---|---|
| `open_scan` | `path` | Point the viewer at a local export. Returns the volume catalog. |
| `list_volumes` | none | Volume ids plus geometry: dimensions, voxel spacing, field of view. |
| `select_volume` | `id` | Display that volume. |
| `set_view_mode` | `mode` | One of the eight reading modes, by name. |
| `set_window_level` | `preset` or `center` + `width`, optional `invert` | The density window. |
| `navigate_slice` | `pane`, `index` or `delta` | Move an MPR pane to a slice. |
| `snapshot` | none | PNG of the current viewing area, all visible panes. |
| `reset_view` | optional `full` | Cameras back to orthogonal; `full` also resets window, inversion, gamma. |

Mutating verbs return the resulting viewer state, so the agent always knows
where it stands. When the selected image is a 2D radiograph, the volumetric
verbs (`set_view_mode`, the HU presets) answer with a clear error instead of
acting; numeric windowing, `snapshot`, and `reset_view` work unchanged.

## 9.4 One viewer at a time

The newest open viewer tab holds the agent connection. Opening a second tab
evicts the first, which shows a banner and keeps working by hand; agent
commands go to exactly one tab, never race between two.

The full technical contract, including the architecture, lives in
[docs/mcp.md](../mcp.md).
