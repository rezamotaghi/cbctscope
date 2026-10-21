# AI-agent control over MCP

CBCTScope ships a [Model Context Protocol](https://modelcontextprotocol.io) server so any MCP-capable agent host (Claude Code, Claude Desktop, and others) can drive the viewer.

## The fence

Every tool is clinical **navigation** or **visualization**. This is a design constraint, not a disclaimer:

- No tool returns findings, interpretations, or diagnoses. `snapshot` returns pixels with a one-line caption of the viewer state (volume, mode, window, slice numbers); reading the pixels is the human's job.
- No tool executes agent-supplied code. The verb set is closed; the viewer rejects unknown verbs.
- Nothing the agent does moves a scan through the viewer to anywhere else. `open_scan` reads a local path in place; `pick_scan` lets the human choose in the native dialog and returns the display label, never the path; results carry display labels and technical geometry only. The one thing that leaves is what the agent explicitly asks to see: a `snapshot` goes to the agent's model, so under a cloud host it leaves this computer as part of that chat, under a local host it does not (manual, section 10.3).
- A saved view is a presentation (cameras, window, render settings), not a finding. A view the agent saves is marked as agent-saved in the sidecar and shows an **agent** badge in the objects panel, so the reader never mistakes it for their own bookmark.
- Resources are read-only mirrors of the same state. Prompts are navigation choreographies distilled from the reading guides; each one ends by handing the snapshots to the reader.

The moment a tool returned a finding, this software would be functioning as a diagnostic device. It does not and will not.

## Threat model

The MCP server runs on the reader's machine, next to medical images. Its host starts it as a child process and talks to it over stdio: the server opens no port, writes nothing to stdout but the protocol, and logs one startup line to stderr (its version and the viewer address), never a path, a label, or an argument. Four attack classes still apply. For each: what the server and the viewer do, and what is left to the host.

### Tool poisoning and rug pulls

The attack: a server hides instructions in its tool descriptions, or changes them after the user approved them (a rug pull), so the model follows the server instead of the user.

What CBCTScope does:

- The verb set is closed. The fifteen tools are registered once at startup from fixed text in `mcp/server.mjs`; the server never adds, edits, or removes a tool while it runs.
- `tools/list` is deterministic: the SDK lists the tools in registration order, so one release always presents the same list.
- No verb executes code. A poisoned instruction can at most make the agent navigate, bookmark, or capture.
- Every tool declares annotations (read-only or not, never destructive, never open-world). They are hints: the specification tells hosts to treat annotations as untrusted unless the server is trusted, and a host may show them or ignore them.
- Descriptions change only with a release. Read them in `mcp/server.mjs` or the bundle's `manifest.json` before you update.

Left to the host: displaying the descriptions and annotations, pinning the reviewed definitions, and asking again when they change. Another server in the same host session can carry poisoned descriptions that steer the model's use of CBCTScope, for example to pass snapshots to its own tools. Connect CBCTScope only alongside servers you have reviewed.

### Prompt injection through results and images

The attack: text inside a tool result or an image reads to the model as an instruction. On 21/08/25 Trail of Bits showed a prompt hidden in a full-resolution image that becomes legible only after the host downscales it, so the user never sees what the model reads; their Gemini CLI exploit worked because the MCP configuration set `trust` to skip confirmations.

What CBCTScope does:

- Results carry the viewer state and the volume catalog: volume ids, display labels, geometry, window, slice positions, saved-view names. The label comes from the folder or file name you opened, and a saved-view name from whoever saved it, so a crafted name is text the model will read.
- `snapshot` is composed in the browser from the panes on screen, normally at 1.5 times their on-screen size, and the MCP server passes the PNG through unchanged. The image the model receives is the layout on your screen at that moment; no CBCTScope step resamples it after capture.
- Every verb is non-destructive and closed-world, so an injected instruction can at most move the camera, change the window, or save an agent-badged view.

Left to the host: how it scales an image before the model sees it, and the consent prompt before each call. CBCTScope cannot see or prevent a host-side downscale, and no complete defence against image injection exists. Keep confirmations on; in Gemini CLI, leave `trust` unset.

### Confused deputy against localhost

The attack: a hostile web page uses your own browser as its deputy. It fires cross-origin POSTs at a server on `localhost`, or uses DNS rebinding (its domain re-resolves to `127.0.0.1`) so the browser treats the local server as same-origin and lets the page read the answers.

What CBCTScope does:

- The MCP server speaks stdio to its host and listens on nothing.
- The viewer binds to `127.0.0.1` (`npm run dev`, `npm run demo`, `npm start`).
- `middleware.ts` runs on every path, the agent bridge included. It answers 403 to any request whose `Host` is not `127.0.0.1`, `localhost`, or `[::1]`, and to any request that carries an `Origin` that is malformed or not loopback. A rebound request still carries the attacker's hostname in `Host`, so it fails.
- A page served from another port on this machine counts as loopback. [SECURITY.md](../SECURITY.md) places anything that runs on the machine inside the trust boundary.

The same class hit the official MCP SDKs: [CVE-2025-66414](https://nvd.nist.gov/vuln/detail/CVE-2025-66414) (TypeScript, before 1.24.0), [CVE-2025-66416](https://nvd.nist.gov/vuln/detail/CVE-2025-66416) (Python, before 1.23.0), [CVE-2026-34742](https://nvd.nist.gov/vuln/detail/CVE-2026-34742) (Go, before 1.4.0), and [CVE-2026-35568](https://nvd.nist.gov/vuln/detail/CVE-2026-35568) (Java, before 1.0.0). Each concerns an HTTP server on localhost that did not check the `Host` header; the TypeScript and Python advisories state that stdio servers are unaffected. CBCTScope's MCP server uses stdio (TypeScript SDK 1.30.0), and the viewer's HTTP bridge carries the equivalent check in `middleware.ts`.

Left to the host: nothing for this class.

### Runaway agent loop

The attack, or the accident: a model calls verbs without end, on its own or because an injected instruction keeps it going.

What CBCTScope does:

- Every call waits for the viewer's answer and times out (15 s by default, 60 s at most), so no call hangs.
- No verb deletes or overwrites. The only verb that writes is `save_view`, which adds an agent-badged view.
- Closing the viewer tab stops everything: with no viewer connected, every verb fails at once.

Left to the host: the confirmation before each call, and the control that stops the agent.

Missing: there is no rate limit on the agent command bus, although the MCP specification (revision 2025-11-25) says servers MUST rate limit tool invocations. A per-process cap is queued for a later release.

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

### Host by host

Every host takes the same entry: the command `node` and the absolute path to `mcp/server.mjs`. Only the file and its format differ. Replace `/absolute/path/to/cbctscope` with the path of your copy of the repository. On Windows, escape each backslash inside JSON (`C:\\Users\\you\\cbctscope\\mcp\\server.mjs`). Start the viewer and open it in a browser before the host calls a verb.

Each format below was checked against the host's own documentation on 21/10/26; the source is linked under each entry. The two local hosts also say whether the author has run the server under them.

When the host's model runs in the cloud, every result and every snapshot goes to that model's provider. Under a local host (llama-server, LM Studio) they stay on this machine. Whatever a model writes about the images is the host's output, never CBCTScope's.

#### Claude Code

```sh
claude mcp add --transport stdio cbctscope -- node /absolute/path/to/cbctscope/mcp/server.mjs
```

Everything after `--` is the server command. The default scope, `local`, keeps the entry to you in this project; `--scope project` writes it to the project's shared `.mcp.json`, `--scope user` makes it available in all your projects. To set the viewer address, place `--env CBCTSCOPE_URL=http://localhost:3810` before `--transport stdio`: the CLI reads a name placed right after `--env` as another pair.

The JSON form:

```sh
claude mcp add-json cbctscope '{"type":"stdio","command":"node","args":["/absolute/path/to/cbctscope/mcp/server.mjs"]}'
```

Source: [Claude Code MCP docs](https://code.claude.com/docs/en/mcp).

#### Claude Desktop

**Bundle.** Double-click `cbctscope-<version>.mcpb`, drag it into the Claude Desktop window, or choose **Settings > Extensions > Advanced settings > Install Extension…** and select it. Review the details in the install screen and confirm.

**JSON.** Open **Settings** from the Claude menu in the menu bar (not the settings inside the window), then **Developer > Edit Config**. This opens `claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows `%APPDATA%\Claude\claude_desktop_config.json`). Add the `mcpServers` entry from step 1, save, quit Claude Desktop completely, and start it again. The server's stderr goes to `mcp-server-cbctscope.log` in `~/Library/Logs/Claude` (Windows `%APPDATA%\Claude\logs`).

Sources: [MCPB install](https://claude.com/docs/connectors/building/mcpb); [Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

#### ChatGPT desktop app and Codex

The ChatGPT desktop app, the Codex CLI, and the Codex IDE extension share one configuration: `~/.codex/config.toml`, or `.codex/config.toml` in a trusted project.

```sh
codex mcp add cbctscope -- node /absolute/path/to/cbctscope/mcp/server.mjs
```

Or by hand:

```toml
[mcp_servers.cbctscope]
command = "node"
args = ["/absolute/path/to/cbctscope/mcp/server.mjs"]
default_tools_approval_mode = "prompt"
```

`default_tools_approval_mode` takes `auto`, `prompt`, `writes`, or `approve`. OpenAI's docs describe only `writes` (it asks for every tool not marked read-only, so it relies on annotations, which are hints); the line above uses `prompt`, as OpenAI's own examples do.

Source: [OpenAI MCP docs](https://learn.chatgpt.com/docs/extend/mcp).

#### Gemini CLI

In `~/.gemini/settings.json` (every project) or `.gemini/settings.json` (this project):

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

Or `gemini mcp add -s user cbctscope node /absolute/path/to/cbctscope/mcp/server.mjs` (without `-s user` the entry goes to the project).

Leave `trust` unset, and never pass `--trust`. Unset, Gemini CLI shows a confirmation dialog for the server's tool calls. `trust: true` bypasses every confirmation for the server: it is the setting behind the image-scaling exfiltration described under [Threat model](#threat-model). Google's page also notes that Antigravity CLI replaced Gemini CLI for some users on 18/06/26; this entry covers Gemini CLI only.

Source: [Gemini CLI MCP docs](https://geminicli.com/docs/tools/mcp-server/).

#### VS Code

In `.vscode/mcp.json` (workspace) or the user-profile `mcp.json`, under `servers`:

```json
{
  "servers": {
    "cbctscope": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/cbctscope/mcp/server.mjs"]
    }
  }
}
```

Or run `code --add-mcp '{"name":"cbctscope","type":"stdio","command":"node","args":["/absolute/path/to/cbctscope/mcp/server.mjs"]}'`, which writes to the user profile. The portable files (`.mcp.json` at the workspace root, `~/.copilot/mcp-config.json`) take the entry from step 1, under `mcpServers`.

Source: [VS Code MCP configuration reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration).

#### Cursor

In `~/.cursor/mcp.json` (every project) or `.cursor/mcp.json` (this project):

```json
{
  "mcpServers": {
    "cbctscope": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/cbctscope/mcp/server.mjs"]
    }
  }
}
```

Cursor asks for approval before it uses an MCP tool. Keep it that way.

Source: [Cursor MCP docs](https://cursor.com/docs/context/mcp).

#### llama.cpp llama-server (local, no cloud)

Save the `mcpServers` entry from step 1 as a file, for example `cbctscope-mcp.json`. Start the server with a vision model and its projector:

```sh
llama-server -m /path/to/model.gguf --mmproj /path/to/mmproj.gguf \
  --mcp-servers-config /path/to/cbctscope-mcp.json --host 127.0.0.1 --port 8089
```

The flag is experimental and takes stdio servers only, in Cursor's format (`command`, `args`, `env`, `cwd`, `timeout_ms`). The per-call timeout defaults to 30 s: add `"timeout_ms": 330000` to the entry if you use `pick_scan`, which waits up to five minutes for the dialog. Keep `--host 127.0.0.1`; llama-server warns against enabling MCP servers in an untrusted environment. The verbs appear under the server's name as a prefix, for example `cbctscope_viewer_state`.

Run on the author's machine on 21/10/26 (macOS, Homebrew llama.cpp 0.7.0, build 11669; Gemma 4 26B and its projector, from files an Ollama install had already downloaded; the demo viewer): llama-server found all fifteen tools; asked to read the viewer state, the model called `viewer_state` and answered from its result. Through the server's tools endpoint, `snapshot` returned its caption text without the PNG, so in that build the model does not see snapshots.

Source: [llama-server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

#### LM Studio (local, no cloud)

LM Studio is an MCP host from version 0.3.17. In the right sidebar, open the **Program** tab and choose **Install > Edit mcp.json** (the file is `~/.lmstudio/mcp.json`, Windows `%USERPROFILE%/.lmstudio/mcp.json`). Add the `cbctscope` entry from step 1 inside `mcpServers`. LM Studio shows a confirmation dialog before each tool call; do not choose to always allow a tool, which removes that dialog for it.

Unverified: LM Studio's docs say the file follows Cursor's notation but show only a remote (`url`) example, so the stdio entry is not confirmed by them. Untested on the author's machine as of 21/10/26.

Sources: [LM Studio MCP docs](https://lmstudio.ai/docs/app/mcp); [LM Studio 0.3.17 notes](https://lmstudio.ai/blog/lmstudio-v0.3.17).

#### Out of reach by design

ChatGPT on the web, claude.ai on the web, and Microsoft Copilot Studio cannot start a process on your machine. They reach only a server their own cloud can call: ChatGPT web uses remote MCP tools through plugins and does not read local configuration; claude.ai connects from Anthropic's cloud to a server reachable over the public internet; Copilot Studio takes a server URL on the Streamable HTTP transport. Reaching them would take a hosted HTTPS server, which this project will never run. That is the local-first fence at work, not a gap.

Sources: [OpenAI MCP docs](https://learn.chatgpt.com/docs/extend/mcp); [Claude remote connectors](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp); [Copilot Studio MCP](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent).

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
