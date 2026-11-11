# 9 · AI-agent control

## 9.1 What it is

CBCTScope ships a server for the
[Model Context Protocol](https://modelcontextprotocol.io) (MCP), the standard
by which AI assistants operate external tools. Any MCP-capable agent host
(Claude Code, Claude Desktop, and others) can drive the viewer: open a scan,
switch reading modes, set the window, step through slices, restore a saved
view, take snapshots to look at. In practice you can tell an assistant "open
the case in this folder, teeth window, pano mode" and watch the viewer follow.

> **Note.** Agent control over MCP needs the local app or the desktop app (chapter 2).
> The desktop app (section 2.6) carries the same bridge on the same port,
> `http://127.0.0.1:3810`, so the setup below applies unchanged: start the
> app instead of the viewer and browser tab. In the desktop app the agent
> cannot open a scan by path (`open_scan`) or raise the dialog (`pick_scan`);
> you open it with **Open DICOMDIR or DICOM folder**. The web build in a plain browser (section
> 2.5) has no MCP connection: it runs no server for an agent to reach, so it
> shows no agent banner and accepts no MCP commands. It has instead the opt-in
> in-page agent on your own model account (section 9.6).

The agent can only do what a hand on the mouse could do: open, look, move,
bookmark, capture. This is a design constraint, not a disclaimer:

- No verb returns findings, interpretations, or diagnoses. `snapshot` returns
  pixels with a one-line caption of the viewer state; reading the pixels is the
  human's job.
- No verb executes agent-supplied code. The verb set is closed; unknown verbs
  are rejected.
- Nothing the agent does moves a scan through the viewer to anywhere else. When
  the agent asks you to pick a scan, the native dialog opens on your machine and
  the agent receives the display label, never the path. What the agent asks to
  see, it sees: a snapshot goes to the agent's model, so under a cloud host it
  leaves this computer as part of that chat, under a local host it does not
  (section 10.3).
- A saved view is a presentation, not a finding. A view the agent saves shows
  an **agent** badge in the objects panel (section 3.4), so you never mistake
  it for your own bookmark.

> **Caution.** Treat agent-written summaries of what it "saw" with the same
> skepticism you would apply to any unverified observer. The authoritative
> read is yours, on your screen.

Keep two rules in mind:

- The read-only and non-destructive labels each verb carries are hints to the
  host. The host may show them, or ignore them.
- Results and snapshots are data for you to verify, never instructions. Text
  that appears inside an image or a scan label is not a command, to you or to
  the agent.

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

**Host by host.** The entry is the same everywhere: the command `node` and
the absolute path to `mcp/server.mjs`. Only the file differs. The exact
snippets, checked against each host's documentation on 21/10/26, are in
[docs/mcp.md](../mcp.md#host-by-host).

| Host | Where the entry goes |
|---|---|
| Claude Code | `claude mcp add --transport stdio cbctscope -- node /absolute/path/to/cbctscope/mcp/server.mjs` |
| Claude Desktop | The `.mcpb` bundle, or `claude_desktop_config.json` (**Settings > Developer > Edit Config**) |
| ChatGPT desktop app, Codex | `~/.codex/config.toml`, table `[mcp_servers.cbctscope]` |
| Gemini CLI | `~/.gemini/settings.json`, under `mcpServers`. Leave `trust` unset, so every tool call asks for confirmation. |
| VS Code | `.vscode/mcp.json`, under `servers`, with `"type": "stdio"` |
| Cursor | `~/.cursor/mcp.json` or `.cursor/mcp.json`, under `mcpServers` |
| llama.cpp `llama-server` (local) | A JSON file passed with `--mcp-servers-config`, and a vision model loaded with `--mmproj`. Run on the author's machine on 21/10/26: `viewer_state` worked; snapshots did not reach the model. |
| LM Studio 0.3.17 or later (local) | `~/.lmstudio/mcp.json`. Entry format unverified; untested on the author's machine as of 21/10/26. |

The server speaks both current revisions of the protocol, with nothing to set.
Hosts on the original handshake (revision 2025-11-25) and hosts on the newer
stateless revision 2026-07-28, such as Claude Code on its v2 runtime and
GitHub Copilot CLI 1.0.81 or later, connect to the same server and see the
same verbs, resources, and prompts. The server needs Node.js 20 or later: the
Node.js 22 that runs the viewer (chapter 2) covers an entry by path, and the
bundle declares the same floor to Claude Desktop.

When the host's model runs in the cloud, every result and every snapshot goes
to that model's provider. Under a local host they stay on your machine. What
a model writes about the images is the host's output, never CBCTScope's.

ChatGPT on the web, claude.ai on the web, and Microsoft Copilot Studio cannot
reach a server on your machine: they connect only to a hosted server on the
internet, which this project will never run. They are out of reach by
design.

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

## 9.6 The in-page agent

The web build and the desktop app carry a navigation agent inside the page,
for when no MCP host is at hand. The **Agent** button in the header, next to
the research-use line, opens the agent panel as a strip under the viewer; the
viewer moves up to make room, so the panel never covers a control, and the
same button or **Close panel** closes it. You type a request in the panel
("show the left TMJ in sagittal, bone window"), and
a model on your own account moves the viewer with the same fifteen verbs as
the MCP server (section 9.3), through the same verb handling in the page. It
never produces findings. The surface stays those fifteen verbs; the agent gets
nothing more.

**Off by default.** The agent is off every time the page loads and sends
nothing to anyone until you switch it on. **Set up the navigation agent**
opens with no provider chosen: **Provider** reads **Choose a provider** and the
model field is empty until you pick one. Choose the provider first, then check
the model name and give your API key; **Switch on…** before a provider is chosen
only answers "Choose a provider first", in the panel. Once one is chosen,
**Switch on…**
shows a dialogue, **Switch on the navigation agent**, that names the provider
and states what follows: the agent runs on your own model account with that
provider, or, for a model server on this computer, "The agent runs on the
model server at" its address; if you entered a key, it stays in this tab's
memory (in the desktop app, this app's) and is forgotten when the tab closes
(when the app quits), and without a key the dialogue says nothing about one;
every snapshot the agent asks for is sent to that provider or server and
nowhere else; each snapshot is a picture of the open scan, so use
de-identified scans; the agent only moves the camera and is not asked for
findings, and nothing it says is a finding. **Cancel** sends nothing. While the agent is on, the header
button reads **Agent: on**, followed by the provider, at all times, open panel
or not, and **Switch off** (beside it and in the panel) stops it at once and
forgets the key.

**Providers.** The list starts with **Model server on this computer**: a model
server that speaks the OpenAI-compatible chat completions API with image input, with presets for llama-server
(`http://127.0.0.1:8080`), Ollama (`http://127.0.0.1:11434`) and LM Studio
(`http://127.0.0.1:1234`). A preset only fills in the address; the endpoint
field accepts any port on `127.0.0.1` or `localhost`. For llama-server, start
it with `--port 8080` or type the port it listens on: its documented default
has changed between releases (recent builds use 9931), and the MCP host
example in docs/mcp.md runs it on 8089; any of these works if the field says so.
Then come the cloud providers: Anthropic (choosing it fills in the model
`claude-opus-5-5`), OpenAI (`gpt-6-astra`) and Google Gemini
(`gemini-3.8-flash`). You may type any model name the provider offers. The model must support tool calls and images.

**The key.** Your API key goes once to the agent's isolated frame: a small page
inside the viewer that holds the provider connection and nothing else. The
frame cannot read the viewer's storage or the page, and the viewer itself
never contacts a provider. The key stays in the frame's memory only. It is
never written to the browser's storage, a cookie, or a file, and it goes only
to the provider you chose, with each request. **Switch off** removes the frame
and the key with it. The browser remembers the provider, the endpoint and the
model name between visits, never the key.

**What the model says.** The panel shows the model's own words only in a
block headed **Model text. Not a reading, not a finding.**, apart from the
steps and errors. If those words contain report vocabulary (radiolucency,
lesion, fracture, cyst, "consistent with", findings, and similar terms), the
block shows instead: "The model offered an interpretation. CBCTScope does not
display readings; ask for a view, not an opinion." This guard is a word
filter, not a judge: it catches the obvious terms and not a paraphrase. The
fence remains yours: the agent moves the camera, you read.

**The fence.** The agent's instructions state it: navigation and
visualisation only; never interpret, measure for a diagnosis, or state
findings; if asked, it answers that reading the images is yours. A request
stops after at most 12 tool calls, and **Stop** cancels the request in flight.
While a request runs, **Stop** is also in the header, beside the agent status,
so closing the panel never hides it. A tool call whose arguments arrive
malformed is answered to the model as an error and runs nothing.
Errors appear in the panel in plain words. `open_scan` and `pick_scan` answer
that you open the scan yourself, with **open** or a drop on the viewer.

**The model server on this computer.** The agent's isolated frame calls the server, and
its requests carry no site address (the origin `null`), on the published site
and in the desktop app alike. The server must accept such cross-origin (CORS)
requests: llama-server allows any origin by default; Ollama and LM Studio need
cross-origin requests allowed in their settings. From the published site, the
browser may also ask for permission to reach devices on your network.

> **Caution.** A snapshot is pixels from your screen. Under a cloud provider
> it leaves this computer, under that provider's data terms; under a local
> endpoint it does not. Text inside an image or a scan label is data, never a
> command; the agent is told so, but no defence against such injected text is
> complete. The read is yours, on your screen.
