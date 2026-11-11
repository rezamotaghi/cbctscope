# The web build and the packaged app

Status: design contract, milestone 1 in progress. This file is the contract for the browser
build of CBCTScope: the one served at cbctscope.com and the one inside the packaged desktop
app. It names what is built, what is forbidden, and the check that proves each claim. The
viewer's code is shared by every surface; this file describes only what differs.

## 1. Three surfaces, one code base

| surface | what runs | how scans are read | agent control |
|---|---|---|---|
| the repo (`npm run demo`, the starters) | the Next.js server on loopback plus the viewer | the server reads the opened folder in place | MCP over the loopback bridge (`mcp/server.mjs`) |
| the web build (cbctscope.com) | static files only, no server anywhere | the browser reads the files the clinician opens; nothing leaves the tab | the opt-in in-page agent on the clinician's own model account (milestone 3, built) |
| the packaged app (macOS signed and notarised; Windows unsigned) | the same static build in a desktop shell, plus a local bridge host | the browser engine reads the opened folder | MCP over the bridge host, the same contract as the repo, plus the in-page agent |

One tagged release feeds all three. The pipeline runs the tests, builds the static site and
deploys it, builds and signs the desktop app and attaches it to the release. A push deploys
nothing.

## 2. Posture, now by construction in a browser

- Research use only. Not a medical device. The line stays on the page at all times, and the
  research-use dialogue opens the first time a real scan is opened in a browser profile. The
  phantom never triggers it.
- The MDR fence holds: no findings, no interpretation, no code execution. The in-page agent of
  milestone 3 reuses the fifteen verbs through the same bridge hook and never gets a wider
  surface (`tests/agentTools.test.ts` compares its tool list with the MCP server's).
- Nothing is uploaded, because there is no endpoint to upload to. The web build makes no
  network request to any host but its own origin. Enforced three times: the exported HTML
  carries a Content Security Policy whose `connect-src` is `'self'` (plus `frame-src 'self'`
  for the agent frame); the end-to-end suite fails on any off-origin request; a source test
  fails on any absolute URL in browser code outside the agent frame's own module. The opt-in
  agent of milestone 3 does not widen the viewer's policy: its provider adapters, the key and
  the fetch loop run in `agent-frame.html`, a static page the build writes with its own CSP
  meta (`connect-src` the three provider API hosts and loopback, `default-src 'none'`, its one
  inline script by hash; `scripts/agent-frame.mjs`). The panel loads it in an
  `<iframe sandbox="allow-scripts">` without `allow-same-origin`, so the frame's origin is
  opaque and it cannot read the viewer's storage or DOM. Page and frame talk by
  `postMessage`, each checking the other's window and origin (the page: `"null"`; the frame:
  the origin it was served from) and a per-session nonce carried in the frame's address. The
  key is typed in the panel, posted to the frame once, and forgotten by the panel; tool calls
  come back and run through `pageTransport` in the viewer, and their results (snapshots
  included) go to the frame as messages. The suite proves that no request leaves before the
  clinician opts in, that every provider request comes from the frame (origin `null`), and
  that it goes to the chosen endpoint only.
- The model's own words are shown only in the panel's labelled block, "Model text. Not a
  reading, not a finding.", apart from the steps and the status, and the reading-term guard
  (`lib/shared/readingTerms.mjs`) replaces any text carrying report vocabulary with "The model
  offered an interpretation. CBCTScope does not display readings; ask for a view, not an
  opinion." The guard is a word filter, not a judge; the fence remains the clinician's.
- The demo volume is the synthetic phantom only. No real image enters the repo or the build.
- The local app has no size ceiling. The web build shows a notice before a large volume loads.

## 3. The build target

`npm run build:web` sets `CBCTSCOPE_TARGET=web` and `NEXT_PUBLIC_CBCTSCOPE_TARGET=web` and
writes `out/`. In that target `next.config.mjs` sets `output: 'export'`, `images.unoptimized`,
`basePath` from `NEXT_PUBLIC_BASE_PATH` (empty for the domain, `/cbctscope` for the staging
address on GitHub Pages), and `pageExtensions: ['tsx']` so that the route handlers (`route.ts`)
and `middleware.ts` are not part of the target; static export supports neither. If
`pageExtensions` does not exclude the middleware file in practice, the build script sidelines
`app/api` and `middleware.ts` for the duration of the build and restores them. The exported
HTML gets the CSP meta tag. `npm run build` for the local app is untouched.

At runtime `NEXT_PUBLIC_CBCTSCOPE_TARGET === 'web'` selects the browser source (section 4),
shows the browser's picker instead of the native chooser, and hides the controls that need
the server (the agent status, the MCP help entries).

## 4. The source seam

Six client files call `/api/...` today: `CbctApp.tsx`, `volumeData.ts`, `evidence.ts`,
`CbctStitch.tsx`, `CbctViewport.tsx` (comment only), `useAgentBridge.ts`. They are rewritten
to call one interface, chosen once at module level by the target:

```ts
export interface VolumeSource {
  /** openable volumes: opened + fused + the phantom, in that order */
  list(): Promise<ListEntry[]>;
  meta(anon: string): Promise<CbctVolumeMeta>;
  /** Int16 LE HU voxels, x-fastest, y, z-ascending */
  data(anon: string, onProgress?: (fraction: number) => void): Promise<Int16Array>;
  /** the opened source: label and count, or null */
  opened(): Promise<{ label: string; count: number } | null>;
  /** web: files from the picker or a drop; server: the native chooser round-trip.
   * onProgress (web only): 'scan' (files), then 'assemble' (percent), then 'display' */
  open(input: SourceInput, onProgress?: (p: OpenProgress) => void): Promise<OpenResult>;
  close(): Promise<void>;
  registerFused(meta: FusedMeta, voxels: Int16Array): Promise<{ anon: string }>;
  getEvidence(anon: string): Promise<EvidenceFile | null>;
  putEvidence(file: EvidenceFile): Promise<boolean>;
}
```

`serverSource` keeps today's fetches, behaviour preserved, and serves the repo.
`browserSource` serves the web build and the packaged app.

The agent channel gets the same treatment. `useAgentBridge` keeps executing the verbs; the
channel it listens on becomes an `AgentTransport` (`subscribe(onCommand)` and
`reply(id, outcome)`). `sseTransport` is today's SSE stream plus the result POST;
`pageTransport` is an in-memory queue inside the tab, for the in-page agent of milestone 3.
The desktop app mounts `sseTransport` onto its own bridge host (section 12). The web build in
a plain browser mounts no loopback transport. On every surface `agentChannel.ts` merges the
page queue into what `useAgentBridge` listens on (`withPageAgent`), so the in-page agent and
an MCP host reach the same verb switch, and each reply returns on the channel its command
came in on.

## 5. The browser loader

`lib/browser/` ports `lib/server/localSource.ts`: the same four export shapes (one multiframe
file, a slice-per-file series, a DICOMDIR tree walked by DICM magic bytes, single-frame
radiographs), the same contract out. Input is `File[]` with `webkitRelativePath` from
`<input type="file" webkitdirectory>`, one file from `<input type="file">`, or a drop walked
through `DataTransferItem.webkitGetAsEntry`. Detection by magic bytes, never by extension.
Header parse with `dicom-parser` on the first 4 MB (retry 32 MB). Magic bytes are read 64
files at a time (`Promise.all`) and headers eight at a time; classification stays in file
order. The open reports progress to the shell's panel: the scan per file (at most one report
per 50 ms), the assembly from the worker (at least every 2 % or 100 ms), and the display
phase until the viewport announces its first frame. A refusal carries the number of files
scanned and the reasons (compressed transfer syntax, too few slices, no DICM magic, and so
on), shown as "No DICOM volume found in N files". Grouping, sorting and the
limits (8000 files, depth 8, 30 slices minimum, 16 frames minimum, 1.5 GB) as in the server
loader. Assembly runs in a Web Worker and transfers the `Int16Array`; the UI thread never
blocks. Volume ids stay `local_<12 hex>`, derived from a hash of the series identity
(SeriesInstanceUID, or the single file's SOP Instance UID, plus the file count), so sidecars
survive a reopen. The File System Access API is an enhancement in Chromium only, never a
requirement.

Shared code: the pure helpers of `lib/server/dicom.ts` and the phantom move to `lib/shared/`,
written against `Uint8Array` (a `Buffer` is one, so the server keeps working); `lib/server/`
re-exports them. The phantom is generated in the worker on first open and cached in the tab.
Fused volumes live in memory in the tab, as the server's registry does. Sidecars (annotations,
saved views, ROIs) go to IndexedDB, one record per volume id, the same JSON as the server's
evidence file; the source menu adds "Save marks to file" and "Load marks from file" so marks
can travel. Pixels never enter a sidecar.

## 6. Dialogues

- Research use. Opens the first time a real volume is opened in a browser profile. Title
  "Research use only". Body: not a medical device; the agent moves the camera, the human
  reads; nothing leaves this tab (in the desktop app: this computer, read into this app). One
  button, "I understand". Remembered in localStorage.
- Size notice. Before a volume whose voxel bytes exceed `NEXT_PUBLIC_CBCTSCOPE_SIZE_NOTICE_MIB`
  (build-time, default 512) is loaded: the size, the fact that the browser must hold it in
  memory, the line that the viewer run from the repository has no such limit, "Continue" and "Cancel".
- Agent opt-in: milestone 3.

Every dialogue follows hard rule 4: full contrast, nothing hidden. Its one exception applies
here: a scrim may dim the page behind an open dialogue, whose controls cannot be used while
it is open.

## 7. The landing

The page opens on the phantom, as the repo's demo mode does. The source menu offers "Open
DICOMDIR or DICOM folder" and "Open a single DICOM file" (a multiframe volume or a 2D
radiograph); a drop anywhere on the viewer opens too ("Drop a DICOM folder, a DICOMDIR or a
single file here"). The header carries "Research use only. Not a medical device." at all
times, and links to the repository and, as "Download the desktop app", to the releases page.
The manual (section 13) opens from the help menu, the one door to it on every surface.

## 8. Tests and gates

Unit (vitest): the loader against synthetic DICOM written by `tests/fixtures/dicomWriter.ts`
from the phantom (explicit VR little endian; a multiframe file, a slice-per-file series, a
single radiograph, a DICOMDIR-style tree with extensionless files); id stability across
reopen; the size-notice decision; the CSP string; the absolute-URL scan of browser code.

End-to-end (Playwright, Chromium, against `out/` on a static server): the phantom renders
(the canvas is not blank); the fixture folder opens through the directory input; every view
mode mounts; the research-use dialogue appears once; the size notice appears on a
low-threshold test build; no off-origin request happens; the two sidecar actions round-trip;
a build with the staging base path (`/cbctscope`, served under that prefix only) renders the
phantom, starts the assembly worker and compiles a codec WASM from under the prefix.

Budget: the first measured bundle size becomes the budget with ten percent headroom, recorded
in the test.

Gates: the existing four plus `npm run build:web` and `npm run test:e2e`; CI runs all of them
on every pull request. A change to the agent surface still runs `npm run mcp:smoke` against
the dev server.

## 9. The pipeline

`release.yml` runs on `release: published` only: build the web target, deploy to GitHub Pages
(every action pinned to a commit SHA; only the pages job gets `pages: write` and
`id-token: write`), then (milestone 2) the macOS job. Until the domain is switched on, the
site answers at the repository's GitHub Pages address only. The `CNAME` file and the DNS
records are a separate, deliberate commit.

## 10. Milestones

1. The static viewer: sections 3 to 9 without the desktop and agent parts.
2. The packaged app: the shell chosen from measured facts (bundle size, build on CI,
   notarisation flow); the bridge host implements the loopback contract of `/api/agent/*` so
   that `mcp/server.mjs` and the MCPB bundle work unchanged; codesign with hardened runtime
   and timestamp, notarisation, stapling; a first-launch test on a clean user account;
   Windows unsigned.
3. The in-page agent: the opt-in dialogue, the clinician's own provider key held in memory
   for the session only, snapshots to the provider only, the same fifteen verbs, chapter 9
   updated. **Built** (decisions in section 12).

## 11. Documentation, definition of done for milestone 1

README: a "Use it in the browser" section and the privacy sentence. Manual: chapter 2 (the
web build), chapter 4 (opening in the browser, the drop), chapter 7 (the marks file),
chapter 9 (the web build has no MCP yet), chapter 10 (10.5 "The web build": what stays in the
tab, IndexedDB, nothing uploaded), chapter 11 (browser memory, picker support). `AGENTS.md`
gains one layout line for `lib/browser/` and `lib/shared/` inside its byte cap.

## 12. Decisions

### Milestone 1, confirmed at review

- Host: GitHub Pages, deployed from the release event, no new vendor. Cloudflare Pages is the
  alternative if real response headers are wanted later.
- Sidecars in IndexedDB plus a marks file, not downloads only.
- Size notice threshold 512 MiB of voxels, unmeasured; the builder measures Chromium's limit
  with a synthetic volume and records the number here.
- Picker: the directory input and the drop everywhere; the File System Access API only as an
  enhancement.

### Milestone 2: the desktop shell

Shell: Electron. The packaged app must run the engine the web build is tested on: Chromium,
with WebGL, the module worker, WASM and the directory picker, which is what the Playwright
suite exercises. Electron's main process is Node, so the bridge host is plain JavaScript
(`desktop/bridge.mjs`, no dependencies) and `mcp/server.mjs` and the MCPB bundle work
unchanged. Tauri would put the bridge in Rust or a Node sidecar and render in WKWebView on
macOS, an engine the suite never runs. Tauri's smaller bundle was not measured, because the
engine argument decides before size does.

How it is built:

- `desktop/main.mjs` opens one window on `http://127.0.0.1:3810/` (context isolation, no Node
  in the page, the renderer sandbox, web security on, no preload; every `window.open` and
  off-origin navigation denied, `https:` links handed to the system browser). It appends
  `CBCTScope/<version>` to the user agent; `components/cbct/shell.ts` reads it (`IS_DESKTOP`,
  `AGENT_AVAILABLE`), so the same `out/` mounts the agent channel in the app and nothing in a
  browser. Quit stops the bridge and releases the port.
- `desktop/native.mjs` holds what the operating system shows: the menu bar (File with
  **Open…**, Edit, View with zoom and full screen, Window, Help whose first item opens the
  manual drawer through a window event that `ManualDrawer.tsx` answers), the About panel, the
  save panel's title ("Save snapshot" or "Save export", from the `will-download` handler) and
  the port-in-use dialogue. The packaged app quits before any window when launched with
  `--remote-debugging-port` or `--remote-debugging-pipe`. `package.json` `productName` names
  the app CBCTScope; the profile folder stays `cbctscope`, its name before. The Info.plist
  declares no camera, microphone, Bluetooth or audio-capture use (`mac.extendInfo`), and
  `scripts/desktop-after-pack.mjs` sets `NSAllowsArbitraryLoads` to false; the window's
  loopback traffic goes through Chromium's own network stack, which that key does not govern.
  `tests/desktopNative.test.ts` covers it.
- `desktop/bridge.mjs` serves `out/` (MIME by extension, confined to `out/`, no listing) and
  `/api/agent/command`, `/api/agent/events`, `/api/agent/result` with the agentBus contract,
  behind the Host, Sec-Fetch-Site and Origin checks of `middleware.ts`. Port 3810 and no
  other: the origin holds the marks, the research acknowledgement and the agent settings, so a
  taken port shows a native dialog and the app quits (no random port since the hardening pass
  of 04/11/26). Static files are confined to `out/` by real path, symlinks resolved.
  `tests/desktopBridge.test.ts` covers it.
- Measured fact the plan had missed: the MCP server also reads `/api/cbct` (the catalog, for
  `list_volumes` and two resources) and `/api/cbct/<id>`. In the app the catalog lives in the
  page, so the bridge relays both reads to the page as two internal verbs (`source.list`,
  `source.meta`, answered by `components/cbct/agentChannel.ts` from the browser source):
  geometry and labels only, as in the repo. `open_scan` and `pick_scan` answer 501 with a
  pointer to **Open DICOMDIR or DICOM folder**: the app has no route that takes a path, by design.
- Packaging: `electron-builder.yml` (appId `com.cbctscope.app`; mac dmg and zip, arm64 and
  x64, hardened runtime, `desktop/entitlements.mac.plist` with allow-jit and
  allow-unsigned-executable-memory only; Windows nsis and portable, x64, unsigned).
  Electron fuses (`electronFuses`): run-as-node, NODE_OPTIONS and the inspect arguments off,
  embedded asar integrity validation and only-load-app-from-asar on, plus
  `resetAdHocDarwinSignature` so the unsigned local build still launches on Apple silicon (the
  fuse patch breaks the ad-hoc signature otherwise); a signed build is signed after the fuses.
  The app icon has one source, `desktop/icon/cbctscope.svg`; `npm run icon` (`scripts/icon.mjs`)
  renders the committed `icon.icns` and `icon.ico` (`mac.icon`, `win.icon`) and the web build's
  `app/icon.svg` and `app/apple-icon.png`.
  Notarisation in electron-builder 26.18.0 is driven by the environment: `mac.notarize: true`
  notarises when credentials are present and skips with a warning otherwise. Credentials:
  `APPLE_KEYCHAIN_PROFILE` (a local build without other credentials uses the profile
  `notary`), or `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (the CI route), or
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Signing: `CSC_LINK` and
  `CSC_KEY_PASSWORD`, or a keychain identity.
- Pipeline: `release.yml` runs a `test` job first (typecheck, lint, unit, `build:web`, the
  end-to-end suite) that every build job needs. `desktop-mac` (macos-latest: sign, notarise,
  staple) and `desktop-win` (windows-latest, unsigned) build with `contents: read` and upload
  their dmg, zip and exe as workflow artifacts; the mac job sits behind a gate job that checks
  for `CSC_LINK`. One `publish` job, the only one with `contents: write`, downloads the
  artifacts and runs `gh release upload`. Signing and notarisation secrets reach the
  packaging step only. A release without the secrets deploys the site and the Windows
  packages.

Measured on the author's Mac (Apple silicon, macOS 27.2), 4 November 2026, unsigned build:

| measure | value |
|---|---|
| Electron / electron-builder | 45.2.2 / 26.18.0 |
| `out/` (the web build inside) | 8.6 MB |
| `.app` on disk | 266 MB arm64, 269 MB x64 |
| dmg | 123.2 MB arm64, 127.1 MB x64 |
| zip | 119.6 MB arm64, 123.5 MB x64 |
| package build, both architectures | 49 s first run (downloads included), 39 s after |
| launch to first frame | 0.25 s; to the viewer connected on the bridge 0.55 s (warm) |
| `npm run mcp:smoke` against the packaged app | all checks passed, both protocol eras |

The Windows target does not build on this Mac: electron-builder's bundled `makensis` is an
x86_64 binary and the machine has no Rosetta. The `desktop-win` job builds it on CI. Open for
milestone 2: the first signed and notarised build with the credentials present, and the
first-launch test on a clean user account.

### Milestone 3: the in-page agent

Built to the owner's decisions of 04/11/26:

- Providers: "Model server on this computer" (an OpenAI-compatible chat completions server
  with image input on loopback), listed first, then Anthropic, OpenAI and Google Gemini; the
  panel opens on "Choose a provider" with an empty model field, and a choice fills the model
  in (amended 11/11/26: nothing is preselected). Presets for
  llama-server `http://127.0.0.1:8080`, Ollama `http://127.0.0.1:11434` and LM Studio
  `http://127.0.0.1:1234`; the endpoint field accepts any loopback port (current llama-server
  builds default to 9931, so the preset is a starting point, not a claim about the default).
  The panel docks as a strip under the viewer, opened from the header's Agent button, and
  pushes the viewer up rather than covering any control (hard rule 4). Closing the panel
  unmounts it; a request in flight keeps its Stop in the header beside the status and Switch
  off (the session lives in `agent/agentUi.ts`). Plain `fetch`, no SDKs, one adapter per
  provider in `components/cbct/agent/frame/providers/`, bundled only into the agent frame
  (section 2); every cloud base address lives in `frame/providers/hosts.ts`, the one module
  `tests/noAbsoluteUrls.test.ts` allows them in, and no module outside `frame/` imports an
  adapter. The loopback presets live in `agent/catalog.ts`, which the panel reads. Shapes from each provider's documentation,
  read 04/11/26: Anthropic Messages (`anthropic-version: 2026-10-21` and the
  `anthropic-dangerous-direct-browser-access` header a browser caller sends), default model
  `claude-opus-5-5`; OpenAI Responses (its current models take tools through Responses
  only; stateless, `store: false`), default `gpt-6-astra`; Gemini `generateContent`
  (declarations narrowed to the OpenAPI subset, thought signatures sent back), default
  `gemini-3.8-flash`; the local endpoint takes a free model id, `qwen3-vl:8b` for the Ollama
  preset (its documented vision example) and empty for the other two (the server's loaded
  model).
- The key lives in the frame's module memory only (`agent/frame/keyStore.ts`); `tests/agentPolicy.test.ts`
  fails on any storage API under `components/cbct/agent/`. The provider, endpoint and model
  id persist in localStorage through `lib/shared/agentSettings.ts`, which writes those three
  fields only.
- The opt-in dialogue (title "Switch on the navigation agent", buttons "Switch on" and
  "Cancel") names the provider (for the model server on this computer, "The agent runs on the
  model server at" its address), states the key term only when a key was entered, the snapshot
  term (sent to that provider only; each snapshot is a picture of the open scan, so use
  de-identified scans) and the fence; for the model server it adds that the server must accept
  requests from the agent's isolated frame (CORS). Off on every load; while on, the panel reads "Agent: on,"
  and the provider at all times, beside "Switch off".
- The loop (`agent/frame/loop.ts`, in the frame): the fence as the system prompt and the
  fifteen verbs as tools, both composed in the page from `lib/shared/verbs.mjs` (the module
  the MCP server imports) and sent to the frame once, calls executed in the page through
  `pageTransport` with their arguments checked against the verb's Zod schema (malformed or
  truncated argument JSON is answered as an argument error, never run with defaults), each
  call bounded by the bus timeout and the Stop control, a
  snapshot returned as an image (scaled to at most 2000 px on its longer side), at most 12
  tool calls per request, Stop aborts the request in flight, errors in plain words. A failed
  or stopped request leaves no half turn in the conversation.
- `connect-src`: the viewer `'self'`; the agent frame `https://api.anthropic.com
  https://api.openai.com https://generativelanguage.googleapis.com http://127.0.0.1:*
  http://localhost:*` (section 2).
- `tests/e2e/agent.spec.ts` drives the panel against a fake OpenAI-compatible server on
  loopback (`tests/e2e/fakeProvider.mjs`): off on load, Cancel sends nothing, a request
  switches the view mode and the snapshot reaches the server as an image part, every
  request goes to that origin only and comes from the frame, Switch off and the header's Stop
  end a held multi-step turn (the fake server holds the second reply until the test releases
  it, so no timing guess), and report vocabulary in the model's text is replaced.
- The local endpoint from the published https site: verified in Chromium only from the
  suite's loopback http origin (cross-origin to the fake server, CORS preflight answered).
  Not verified: an https page reaching `http://127.0.0.1` (Chromium treats loopback as
  potentially trustworthy, so mixed-content blocking should not apply, but its
  local-network-access permission prompt and each server's CORS settings decide), and
  other browsers. The frame's requests carry `Origin: null` on every surface, the desktop app
  included: llama-server answers any origin by default; Ollama and LM Studio need cross-origin
  requests allowed in their settings (measured against the fake server only).

### Known limitations, hardening pass of 04/11/26

- Framing. A CSP delivered in a meta tag cannot carry `frame-ancestors`, and GitHub Pages
  sends no response headers, so another site may frame the published viewer. No
  frame-busting script is used. Remedy: a host that sets headers
  (`Content-Security-Policy: frame-ancestors 'none'`), for example Cloudflare Pages.

## 13. The manual

One source: the markdown under `docs/manual/` and `docs/reading-modes/`, in the order of
`docs/manual/manifest.json`, readable on GitHub as before and drift-checked by
`tests/manual.test.ts`. `scripts/manual-html.mjs` renders it at build time into static pages
under `public/manual/` (ignored by version control, never committed); `npm run build`,
`npm run dev` (its predev step), `npm run demo` and `scripts/build-web.mjs` run it, so every
surface serves the manual from its own origin. Rendering is `marked` (exact version, no
dependencies of its own).

Each manifest entry is one page, plus `index.html` with the manifest as the table of contents
and the version and manual revision. Headings carry GitHub's anchors, links between chapters
point at the generated pages, links to other repo files at the project page in a new tab, and
the stills are copied into `manual/media/`. The search box filters `search-index.json` in the
page. No inline script and no remote asset, so the export's CSP meta tag, written into these
pages like every other, holds; every address is relative, so the `/cbctscope` base path holds.

Every page's header carries the posture line and an "Open the viewer" link, one level up to the
viewer beside `manual/`; in the drawer (below), where the viewer is already beside the page,
`manual.js` drops that link.

Two forms:

1. **The pages on the site**: `manual/` beside the viewer. The help menu opens them in a
   new tab.
2. **The help drawer in the app**: in the local app and the desktop app, the help menu
   opens the same pages in an iframe in a column
   at the right of the viewer's row, which narrows the viewer and covers no control, with a
   "Close manual" button. The drawer adds `?theme=dark`, so its pages stay dark beside the
   viewer; the pages in a tab follow the system setting.

At phone width the table of contents collapses behind a "Contents" button that stays on
screen at the top of every page; on wide screens it is the left column, always open.

A printed form can be generated later from the same pages.

Tests: `tests/manualHtml.test.ts` (one page per entry, every internal link and anchor
resolves, every still exists, no em dash, the search index covers every heading, the drawer's
addresses); `tests/e2e/web.spec.ts` and `tests/e2e/base-path.spec.ts` load `manual/` from the
export with no off-origin request.
