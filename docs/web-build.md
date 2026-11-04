# The web build and the packaged app

Status: design contract, milestone 1 in progress. This file is the contract for the browser
build of CBCTScope: the one served at cbctscope.com and the one inside the packaged desktop
app. It names what is built, what is forbidden, and the check that proves each claim. The
viewer's code is shared by every surface; this file describes only what differs.

## 1. Three surfaces, one code base

| surface | what runs | how scans are read | agent control |
|---|---|---|---|
| the repo (`npm run demo`, the starters) | the Next.js server on loopback plus the viewer | the server reads the opened folder in place | MCP over the loopback bridge (`mcp/server.mjs`) |
| the web build (cbctscope.com) | static files only, no server anywhere | the browser reads the files the clinician opens; nothing leaves the tab | milestone 3: an opt-in in-page agent on the clinician's own model account |
| the packaged app (macOS signed and notarised; Windows unsigned) | the same static build in a desktop shell, plus a local bridge host | the browser engine reads the opened folder | MCP over the bridge host, the same contract as the repo |

One tagged release feeds all three. The pipeline runs the tests, builds the static site and
deploys it, builds and signs the desktop app and attaches it to the release. A push deploys
nothing.

## 2. Posture, now by construction in a browser

- Research use only. Not a medical device. The line stays on the page at all times, and the
  research-use dialogue opens the first time a real scan is opened in a browser profile. The
  phantom never triggers it.
- The MDR fence holds: no findings, no interpretation, no code execution. The in-page agent of
  milestone 3 reuses the fifteen verbs through the same bridge hook and never gets a wider
  surface.
- Nothing is uploaded, because there is no endpoint to upload to. The web build makes no
  network request to any host but its own origin. Enforced three times: the exported HTML
  carries a Content Security Policy whose `connect-src` is `'self'`; the end-to-end suite
  fails on any off-origin request; a source test fails on any absolute URL in browser code.
  Milestone 3 widens `connect-src` to the chosen model provider only, and the suite proves
  that no request leaves before the clinician opts in.
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
  /** web: files from the picker or a drop; server: the native chooser round-trip */
  open(input: SourceInput): Promise<{ ok: true; label: string; count: number } | { ok: false; error: string }>;
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
`pageTransport` is an in-memory queue inside the tab, used by the in-page agent in milestone 3
and by the desktop shell's bridge host in milestone 2. The web build of milestone 1 mounts no
transport.

## 5. The browser loader

`lib/browser/` ports `lib/server/localSource.ts`: the same four export shapes (one multiframe
file, a slice-per-file series, a DICOMDIR tree walked by DICM magic bytes, single-frame
radiographs), the same contract out. Input is `File[]` with `webkitRelativePath` from
`<input type="file" webkitdirectory>`, one file from `<input type="file">`, or a drop walked
through `DataTransferItem.webkitGetAsEntry`. Detection by magic bytes, never by extension.
Header parse with `dicom-parser` on the first 4 MB (retry 32 MB). Grouping, sorting and the
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
  "Research use only". Body: not a medical device; the viewer moves the camera, the human
  reads; nothing leaves this browser. One button, "I understand". Remembered in localStorage.
- Size notice. Before a volume whose voxel bytes exceed `NEXT_PUBLIC_CBCTSCOPE_SIZE_NOTICE_MIB`
  (build-time, default 512) is loaded: the size, the fact that the browser must hold it in
  memory, the line that the local app has no such limit, "Continue" and "Cancel".
- Agent opt-in: milestone 3.

Every dialogue follows hard rule 4: full contrast, nothing dimmed or hidden.

## 7. The landing

The page opens on the phantom, as the repo's demo mode does. The source menu offers "Open
folder" and "Open file"; a drop anywhere on the viewer opens too. The header carries
"Research use only. Not a medical device." at all times, and links to the download
(milestone 2) and the repository.

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
   updated.

## 11. Documentation, definition of done for milestone 1

README: a "Use it in the browser" section and the privacy sentence. Manual: chapter 2 (the
web build), chapter 4 (opening in the browser, the drop), chapter 7 (the marks file),
chapter 9 (the web build has no MCP yet), chapter 10 (10.5 "The web build": what stays in the
tab, IndexedDB, nothing uploaded), chapter 11 (browser memory, picker support). `AGENTS.md`
gains one layout line for `lib/browser/` and `lib/shared/` inside its byte cap.

## 12. Decisions taken for milestone 1, confirmed at review

- Host: GitHub Pages, deployed from the release event, no new vendor. Cloudflare Pages is the
  alternative if real response headers are wanted later.
- Sidecars in IndexedDB plus a marks file, not downloads only.
- Size notice threshold 512 MiB of voxels, unmeasured; the builder measures Chromium's limit
  with a synthetic volume and records the number here.
- Picker: the directory input and the drop everywhere; the File System Access API only as an
  enhancement.
