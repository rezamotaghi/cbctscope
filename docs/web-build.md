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

One tagged release feeds all three. The pipeline runs the tests, builds the static site,
builds and signs the desktop app and attaches it to the release, and only then deploys the
site. A push deploys nothing.

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
- The local app holds the whole volume in a browser tab as well, and shows no notice. The web build shows a notice before a large volume loads.

## 3. The build target

`npm run build:web` sets `CBCTSCOPE_TARGET=web` and `NEXT_PUBLIC_CBCTSCOPE_TARGET=web` and
writes `out/`. In that target `next.config.mjs` sets `output: 'export'`, `images.unoptimized`,
`basePath` from `NEXT_PUBLIC_BASE_PATH` (empty for the domain, which the release builds;
`/cbctscope` for a build served from a sub-path, kept working by the end-to-end suite), and `pageExtensions: ['tsx']` so that the route handlers (`route.ts`)
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

The folder item has two entrances and one loader (`components/cbct/folderPicker.ts`).
Chromium's `<input webkitdirectory>` follows the pick with its own "Upload N files to this
site?" confirmation (`FileSelectHelper::OnListDone` in `chrome/browser/file_select_helper.cc`
shows it only for `SELECT_UPLOAD_FOLDER`, the folder chooser's mode); to a clinician it reads
as the opposite of what happens. So where `window.showDirectoryPicker` exists in a secure
context (Chrome, Edge, Arc; not Brave, which ships it off, nor Firefox or Safari), checked by
feature detection at click time, the item opens it with `{ id: 'cbctscope-dicom-folder',
mode: 'read' }`: read access only, no `startIn`, the handle never stored, nothing requested
again. The handle is seen as drop entries and walked by the drop walker, so the scan gets the
same `File[]` with the same relative paths, limits and stop reason; `getFile()` returns
snapshots and bytes are read only by the scan and the worker. The reader's cancel
(`AbortError`) does nothing; no picker, or any other error, opens the classic input as
before. The desktop app keeps the classic input: its Open sheet has not been checked with the
directory picker. A drop never shows the confirmation, which lives in the chooser path only.

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
  reads; nothing leaves this tab (in the desktop app: this computer, read into this app), except the
  agent's snapshots of the view, which go to the chosen model once the reader switches it on. One
  button, "I understand". Remembered in localStorage.
- Size notice. Before a volume whose voxel bytes exceed `NEXT_PUBLIC_CBCTSCOPE_SIZE_NOTICE_MIB`
  (build-time, default 512) is loaded: the size, the fact that the browser must hold it in
  memory, the line that the viewer run from the repository holds it in a tab as well and only shows no
  notice, "Continue" and "Cancel".
- Agent opt-in: milestone 3.
- The browser's own prompts when a folder is opened are not ours and cannot be reworded. The
  line under the folder item prepares for them: where the directory picker is used, "Your
  browser will ask to let this page view and copy the files. It reads them into this tab and
  sends them nowhere."; where the classic input is used, the line that the browser may say
  "upload" and that the files stay in this tab; in either plain-browser case a second line,
  "Or drop the folder on the viewer: the browser asks nothing."; in the desktop app, the same of its Open sheet and this computer.

Every dialogue follows hard rule 4: full contrast, nothing hidden. Its one exception applies
here: a scrim may dim the page behind an open dialogue, whose controls cannot be used while
it is open. Tab and Shift-Tab stay inside the open dialogue, and its one primary button, the
right-most, is the only one drawn in the accent.

A note is something to read, an entry something to choose, and the two never look alike. In
every menu, popover, card, strip and dialogue, explanatory text that sits among choosable
entries takes the one `note` class of `app/globals.css` (the meta size, `--text-dim`, regular
weight, set apart from the entries above it by spacing or a separator), never an inline style;
entries keep the full text colour and the hover lift. A note is not a control, so hard rule 4's
full contrast for controls does not bind it; `--text-dim` on the menus' `--panel` is 7.1:1.

## 7. The landing

Before any script runs, the exported home page already holds text (section 14): a heading,
what CBCTScope is and who made it, that scans are read in the tab and never uploaded, that it
is research software and not a medical device, and plain links to the manual, the eight
reading guides, the About and legal pages, the source and the author's project page. From
768 px of width up it is
the loading state of the client-only viewer, so the viewer takes its place once its code has
loaded, and nothing on the reading screen changes. The page opens on the phantom, as the
repo's demo mode does. The source menu offers "Open
DICOMDIR or DICOM folder" and "Open a single DICOM file" (a multiframe volume or a 2D
radiograph); a drop anywhere on the viewer opens too ("Drop a DICOM folder, a DICOMDIR or a
single file here"). The header carries "Research use only. Not a medical device." at all
times; its last button, "Download the desktop app" ("Desktop app" on a narrower window), shown
in a plain browser only, opens a menu built like Open and Help (`components/downloads.ts`):
"Mac with Apple silicon", "Mac with Intel" and "Windows" link
`/releases/latest/download/<fixed name>` (section 9), then, under a separator, a note on telling
the Macs apart, then "All downloads and release notes" links `/releases/latest`. The visitor's own
system comes first, read from the user agent when the menu opens; no entry is hidden and the
Mac's chip is never guessed. Every entry is a link the reader clicks; opening the menu
requests nothing. The Help menu and the About popover link the
repository; the Help menu also opens **About CBCTScope**, **Cite this software** and
**Legal notice**, and the About popover links the About page (section 14). While the phantom is on screen and nothing is open, the status line at the bottom
says "Your scan is read in this tab and never uploaded." and links "See CBCTScope on a real
scan" to the README's stills of a consented, bone-only real CBCT. The manual (section 13) opens from the Help menu,
the one door to it on every surface.

On a phone the web build's home page is the phone page and the viewer is never mounted: no
panes, no WebGL, and no request for the viewer's code, its WASM or a volume. The device decides,
not a window's width: `components/phone.ts` `PHONE_MEDIA` is a primary pointer that is coarse and
cannot hover, on a viewport under 768 CSS px in width or in height, so a phone gets the page in
both orientations and rotating it never mounts the viewer, while a tablet of 768 by 1024 or more
gets the viewer. A mouse, a trackpad or anything that hovers never gets the phone page. The
phone page is the intro itself (`components/SiteIntro.tsx`), rendered once for every device: its
one heading, the lead, the privacy and research sentences, then a part shown on a phone only,
the manual's MPR still resized to 1200 px (`public/phone-mpr.webp`, the command beside
`PHONE_STILL` in `components/sitePages.ts`), "CBCTScope reads scans on a computer. Open
cbctscope.com there.", three full-width controls (the user manual; the release page, since a
phone cannot run the installers; "Send this link to myself", a `mailto:` with no recipient whose
subject and body carry the site's address, so the phone's own mail app opens a new message and
the page sends nothing), and a row of links to the About and legal pages and the source; on a
phone the loading line and the long list of links are hidden. `app/globals.css` switches on the
same expression, character for character (`tests/phone.test.ts`), so the first paint and the
script agree. The repository's local app has no phone page.

On a computer, the desktop app included, the viewer mounts and stays mounted at every width and
zoom. The desktop app's 1024 px minimum is in screen points and zoom shrinks CSS pixels, so it can
fall below 768 CSS px like a browser window. Below 768 CSS px a full-contrast notice above the
viewer says the window is too narrow to read in and to widen it or zoom out; the header wraps its
groups, the mode tabs may take two lines, and the status line wraps, so no control leaves the
screen. Nothing is unmounted: the open scan, the agent session and unsaved state stay.

## 8. Tests and gates

Unit (vitest): the loader against synthetic DICOM written by `tests/fixtures/dicomWriter.ts`
from the phantom (explicit VR little endian; a multiframe file, a slice-per-file series, a
single radiograph, a DICOMDIR-style tree with extensionless files); id stability across
reopen; the size-notice decision; the CSP string; the absolute-URL scan of browser code.

End-to-end (Playwright, Chromium, against `out/` on a static server): the phantom renders
(the canvas is not blank); the fixture folder opens through the directory input; every view
mode mounts; the research-use dialogue appears once; the size notice appears on a
low-threshold test build; no off-origin request happens; the two sidecar actions round-trip;
a build with the base path (`/cbctscope`, served under that prefix only) renders the
phantom, starts the assembly worker and compiles a codec WASM from under the prefix.

Budget: the first measured bundle size becomes the budget with ten percent headroom, recorded
in the test.

Gates: the existing four plus `npm run build:web` and `npm run test:e2e`; CI runs all of them
on every pull request. A change to the agent surface still runs `npm run mcp:smoke` against
the dev server.

## 9. The pipeline

`release.yml` runs on `release: published` only, every action pinned to a commit SHA, in
this order:

1. `test`: typecheck, lint, unit, the web build, the end-to-end suite.
2. In parallel after it: `build` (the web target for the root of the domain, uploaded as the
   `site` artifact), `desktop-win`, and
   `desktop-gate` then `desktop-mac` (signs, notarises and staples the app and the dmg,
   section 12; skipped without the signing secrets).
3. `publish` attaches the installers to the release, once `desktop-win` succeeded and
   `desktop-mac` succeeded or was skipped. Each installer goes up twice: under its versioned
   name (`CBCTScope-<version>-arm64.dmg`, `-x64.dmg`, `-setup.exe`; the manual cites these),
   and under a fixed name, the same in every release, that the header's download menu links
   through GitHub's `/releases/latest/download/<name>`: `CBCTScope-mac-arm64.dmg`,
   `CBCTScope-mac-x64.dmg`, `CBCTScope-windows-setup.exe` (defined once in
   `components/downloads.ts`; `tests/downloads.test.ts` fails if `release.yml` names others).
   The fixed names are byte copies made in the build jobs, never a rebuild: the mac job copies
   each dmg only after it is signed, notarised, stapled and checked, then runs `cmp`,
   `xcrun stapler validate` and `spctl --assess` on each copy (a stapled ticket is written into
   the dmg itself, so a byte copy carries it); the Windows job copies the setup exe after
   packaging and runs `cmp`. A release without the mac secrets carries no mac files, fixed
   names included.
4. `deploy` puts the site on Vercel only after `build` and `publish` succeeded, and only when
   the release is GitHub's latest release and carries all three fixed names, and checks it
   (below). The site and the installers go public together: a failed desktop build, a
   prerelease, or a release without the macOS installers leaves the site as it was, never
   linking to a release without installers.

On release day a human checks, in a browser, that the release carries the six installer files
(three versioned, three fixed) and that each of the menu's three direct links starts the
download of the file it names. The direct links cannot be exercised before the first release
that carries the fixed names; until then they answer 404, and "All downloads and release
notes" still reaches every file.

### The site on Vercel

The release job is the site's one trigger. The Vercel project is not connected to the
repository: **do not connect it through Vercel's Git integration**, or every push would
deploy. Installers stay GitHub release assets; only the pages are on Vercel.

How `deploy` ships the site (`release.yml`):

1. `node scripts/release-assets.mjs` checks, once, the release that started the run (its id
   from the event, through GitHub's REST API with the job's read-only token). The menu's
   links go through `/releases/latest/download/<name>`, so it first reads GitHub's latest
   release and fails the job unless that is this release: a prerelease, or a release
   published with "Set as latest release" unticked, would leave the links on another release,
   and when no latest release exists at all (only prereleases) the links lead nowhere. Each
   of these failures says to publish the release as the latest release, not as a prerelease.
   It then reads the release's asset list and fails the job, naming each missing file, unless
   the three fixed names are attached as finished uploads. The list is what counts, not job
   results, so installers attached by `publish` and installers the owner attached by hand
   pass alike. A network error or any answer but 200 fails the job too. Nothing waits: a
   failure leaves the site as it was. To recover from missing files, attach them to the
   release, then use **Re-run failed jobs** on that workflow run; the re-run reads the same
   release again, and the `site` artifact it deploys is kept 30 days. The names are
   `REQUIRED_ASSETS` in the script; `tests/downloads.test.ts` fails if they differ from
   `components/downloads.ts`. The rehearsal has no release and does not run it.
2. It downloads the `site` artifact into `out/`, the files `build` made.
3. `node scripts/vercel-output.mjs out "$RUNNER_TEMP/site"` lays them out as a prebuilt
   deployment in the Build Output API v3 form: `.vercel/output/static/` is a byte copy of
   `out/`, and `.vercel/output/config.json` holds the routes, the overrides and the 404 route
   below. The folder is outside the checkout, so nothing else leaves the runner.
4. `deploy/node_modules/.bin/vercel deploy --prebuilt --prod --cwd "$RUNNER_TEMP/site"`
   uploads it. The Vercel CLI lives in `deploy/`, a folder of its own: a private
   `package.json` that pins the one exact `vercel` version and nothing else, and its own
   committed lockfile, installed by `npm ci` in that folder only. It is not in the app's
   dependency tree, so contributors and the other jobs never install it, and its transitive
   tree stays off the app's audit surface; Dependabot watches the folder on its own. The
   folder sits at the root beside `mcp/`, the other npm package with its own lockfile, so it
   follows the same pattern; electron-builder's `files` allowlist leaves it out, and
   `tsconfig.json` excludes it. Nothing is built on Vercel. The job runs in the GitHub
   environment `production`, whose secrets (`VERCEL_TOKEN`, `VERCEL_ORG_ID`,
   `VERCEL_PROJECT_ID`, `VERCEL_AUTOMATION_BYPASS_SECRET`) no other job can read; the first
   three reach this step only. `VERCEL_TELEMETRY_DISABLED=1` keeps the CLI from reporting its
   use. Only the CLI's stdout is captured, and it must be exactly one https address, the new
   deployment's own; anything else fails the job and prints what was captured. No documented
   flag forces plain output (`--json` and `--non-interactive` switch to JSON whose shape the
   docs do not give), so the default mode is used and the strict parse is the guard. The job
   needs no permission beyond reading the repository and stops after 30 minutes.
5. `node scripts/site-check.mjs --base-from "$RUNNER_TEMP/deploy.txt" --out out` checks that
   deployment at its own address (Deployment Protection covers it, so the bypass secret goes
   along), which works before and after the domain's address records point at Vercel. It
   fails the job unless every file in `out/` and every address in `out/sitemap.xml` answers
   200 with no redirect, serves its file byte for byte with the Content-Type its extension
   needs (`text/html`, `application/javascript` or `text/javascript`, `text/css`,
   `application/wasm`, and so on; an extension the check has no type for fails its unit test),
   and carries the three headers below; and a missing address answers 404 with `404.html`.
   Byte identity is the proof that nothing was injected: no analytics, no speed-insights
   script, no toolbar. The check runs up to three times, 15 s apart, because a new
   deployment's own address can answer 404 for a moment after the CLI reports it ready; the
   last run decides. Each request gives up after 20 s; a 401 or 403 is reported once, as a
   missing or wrong bypass secret.

What `config.json` sets:

- Response headers on every address, on top of the page's own CSP meta tag, which stays
  exactly as `build-web` writes it, because it also protects the desktop app:
  `Content-Security-Policy: frame-ancestors 'none'` (a second policy that only adds the one
  directive a meta tag cannot carry), `X-Frame-Options: DENY` (the same for browsers without
  CSP level 2) and `X-Content-Type-Options: nosniff` (each file is used only as the type it is
  served with). The agent frame is the one page the site frames itself, so it gets
  `frame-ancestors 'self'` and `SAMEORIGIN`. No Referrer-Policy is set: outbound links keep
  the browser's default and carry the origin.
- Addresses: Next writes `about.html`, `legal.html` and `update.html`; `overrides` serves them
  at `/about`, `/legal` and `/update`, their canonical addresses, without a redirect. The manual keeps its `.html`
  addresses as the sitemap lists them, so a blanket `cleanUrls`, which would redirect them,
  is not used. `/` and `/manual/` are their folders' `index.html`.
- A miss answers 404 with the export's `404.html` (an error-phase route).

The host's own request statistics are the only visitor numbers; no script runs in the page
to count anyone.

**The rehearsal.** `.github/workflows/site-rehearsal.yml`, started by hand from the Actions
tab, runs the same build, layout and check against a **preview** deployment (`vercel deploy
--prebuilt` without `--prod`) and its own address, in the GitHub environment `rehearsal`,
stopping after 45 minutes. The check refuses `cbctscope.com` and `www.cbctscope.com` as its
address, so a rehearsal never checks production. Previews sit behind Vercel's Deployment
Protection, so the check sends the Protection Bypass for Automation secret in the
`x-vercel-protection-bypass` header, and no other header: if Vercel injects its toolbar into
the preview, the byte check fails and names it.

**The owner's one-time setup.** The order matters: the site becomes public only through a
release, after its check passed, and only when the address records change at the end.

1. In the Vercel Pro team, create the project **without importing a Git repository**:
   `vercel project create cbctscope --scope <team>` (an older CLI, such as 48.2.0, spells it
   `vercel project add cbctscope --scope <team>`, with the same effect), then, in an empty
   folder outside the repository, `vercel link --yes --project cbctscope --scope <team>`,
   which writes `.vercel/project.json` with the `orgId` and `projectId` needed below. The
   framework preset and build settings do not matter: a prebuilt deployment skips them.
2. Project settings: leave **Analytics** (Web Analytics) and **Speed Insights** off (both
   work only when the site carries their script, which it does not; enabling Web Analytics
   also adds routes under `/_vercel/insights/`). Under General, **Vercel Toolbar**, set
   Pre-Production Deployments and Production Deployments to **Off** (and the same in the
   team's settings if the team default is on). Under Deployment Protection keep **Standard
   Protection** (every deployment's own address protected, the production domain public) and
   create a secret under **Protection Bypass for Automation**.
3. GitHub, the repository's Settings, Environments: create `production` and `rehearsal`.
   For each, under **Deployment branches and tags**, choose **Selected branches and tags**
   (of No restriction, Protected branches only and Selected branches and tags). The page then
   shows "No branch or tag rules applied yet: all branches and tags are still allowed to
   deploy"; press **Add deployment branch or tag rule**, which asks for the Ref type (Branch
   or Tag) and the name pattern, then **Add rule**:
   `production` gets one rule of Ref type **Tag** with the name pattern `v*` (the release
   tags; the rule is matched against the run's `GITHUB_REF`, and patterns use Ruby's
   `File.fnmatch`, where a wildcard does not match `/`); `rehearsal` gets one rule of Ref
   type **Branch** with the name pattern `main`. It worked when the page lists the one rule
   and no longer says that all branches and tags are allowed to deploy.
4. Store the Vercel secrets as **environment secrets**, never as repository secrets: in both
   environments `VERCEL_TOKEN` (an access token, made in the Vercel account's Tokens page,
   scoped to the team), `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` (the `orgId` and `projectId`
   from step 1), and `VERCEL_AUTOMATION_BYPASS_SECRET` (the secret from step 2; the release's
   check reads it too, because a deployment's own address is protected).
5. Store the five Apple secrets as **repository secrets** (Settings, Secrets and variables,
   Actions), because the macOS job runs in no environment:
   - `CSC_LINK`: the Developer ID Application certificate, exported from Keychain Access, My
     Certificates, as a .p12, then base64 on one line: `base64 -i devid.p12 | tr -d '\n'`.
   - `CSC_KEY_PASSWORD`: the password chosen for that export.
   - `APPLE_API_KEY`: an App Store Connect API team key with Developer access, the .p8 file
     Apple lets you download once, base64 on one line the same way.
   - `APPLE_API_KEY_ID`: that key's Key ID.
   - `APPLE_API_ISSUER`: the team's Issuer ID.

   The key can be checked before it is stored: `xcrun notarytool history --key <file.p8>
   --key-id <id> --issuer <issuer>` lists past submissions when the key works. Without
   `CSC_LINK` the macOS job is skipped and the pipeline attaches no macOS installers; the
   site is then deployed only if the macOS installers were attached to the release by hand,
   and otherwise the deploy job fails before the upload, naming the missing files, and the
   site stays as it was. A wrong or missing API key fails the macOS job, so `publish` and
   `deploy` do not run and the site stays as it was.
6. Run **Site rehearsal** from the Actions tab, twice; both must pass. A workflow started by
   hand can be run only once its file is on the default branch, so the rehearsal can run only
   after the branch carrying it is merged to `main`. Vercel makes a new project's first
   deployment a production one whatever the flag, so the first run becomes the project's
   production deployment on its `vercel.app` address. That is harmless while no domain points
   at the project; the second run rehearses a true preview.
7. Settings, Domains: add `cbctscope.com` (and `www.cbctscope.com`, redirecting to it) while
   Porkbun's address records still point elsewhere, so nothing answers there from Vercel yet.
8. Publish the release as the **latest release, not a prerelease** ("Set as latest release"
   ticked). Its job attaches the installers, confirms that the release is the latest and
   carries all three the download menu links to, deploys production and checks the
   deployment; it must pass. If the deploy job fails naming missing installers, attach them
   to the release, then use **Re-run failed jobs** on that workflow run; the re-run reads the
   same release again, and the `site` artifact is kept 30 days.
9. Only then, at Porkbun, change the site's address records: for `cbctscope.com` an **A**
   record with the value shown in the Vercel dashboard, for `www` a **CNAME** with the value
   shown there, removing any older A, AAAA or CNAME records for those two names. The mail
   records (the two MX records and the SPF TXT record) stay as they are.
10. Once the domain shows as configured in Vercel, check the public address against the
    files the release deployed: download the `site` artifact from the release's workflow run
    (kept 30 days), unzip it into a folder, say `site-release/`, and run, from the
    repository, `node scripts/site-check.mjs --base https://cbctscope.com --out
    site-release`. It retries twice, 15 s apart, while the records settle; it must end with
    "serves all".

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

- Host: Vercel (the owner's decision of 12/11/26, before the first public launch), in place of
  GitHub Pages: real response headers, and the host's own request statistics with no script
  in the page. Deployed by the CLI from the release job only (section 9).
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
- `desktop/native.mjs` holds what the operating system shows: the menu bar (on macOS the
  application menu spelled out with **Check for Updates…** after About; File with **Open
  DICOMDIR or DICOM Folder…** (CmdOrCtrl+O), **Open a Single DICOM File…** (CmdOrCtrl+Shift+O)
  and **Save Snapshot…** (CmdOrCtrl+S); Edit; View with zoom and full screen; Window; Help with
  **CBCTScope Help**, **Keyboard and Mouse Reference**, **Cite CBCTScope**, **Legal Notice**,
  **CBCTScope Website**, and on Windows **Check for Updates…** and About), the About panel, the
  save panel's title ("Save snapshot" or "Save export", from the `will-download` handler) and
  the port-in-use dialogue. The packaged app quits before any window when launched with
  `--remote-debugging-port` or `--remote-debugging-pipe`. `package.json` `productName` names
  the app CBCTScope; the profile folder stays `cbctscope`, its name before. The Info.plist
  declares no camera, microphone, Bluetooth or audio-capture use (`mac.extendInfo`), and
  `scripts/desktop-after-pack.mjs` sets `NSAllowsArbitraryLoads` to false; the window's
  loopback traffic goes through Chromium's own network stack, which that key does not govern.
  `tests/desktopNative.test.ts` covers it.
- The menu reaches only what the page already does, the way the first Help item did: File
  clicks the page's own controls by test id (`open-folder-input`, `open-file-input`,
  `snapshot-button`) through `executeJavaScript(..., true)`, the `true` being the user gesture a
  picker or a download needs, and leaves an absent or disabled control alone: the hidden file
  inputs are disabled while the files are read, as the header's Open menu is, and a drop in
  that time is ignored. A dropped folder's tree walk, before its files are read, is not covered. Help sends window
  events: `cbctscope:manual`, whose detail may name a drawer page (`12-shortcuts.html`,
  `legal`), which `menuDrawerPage` in `ManualDrawer.tsx` accepts only from the manifest's pages
  and the drawer's site pages, and `cbctscope:cite`, which opens the citation dialogue. The
  three accelerators are free: the page's key handler ignores any key with Cmd, Ctrl or Alt
  held (`components/cbct/keys.ts`), and Electron's Edit, View and Window roles use none of them.
  Save Snapshot keeps its ellipsis because the `will-download` handler sets the save panel's
  options without a save path, so the panel always follows.
- Updates (the owner's decision of 13/11/26): the app contacts nothing. **Check for Updates…**
  hands `https://cbctscope.com/update#from=<version>` to the system browser
  (`shell.openExternal`, `updateUrl` in `native.mjs`; the bare page for anything but a strict
  major.minor.patch). The page (`app/update/page.tsx`, `components/UpdateStatus.tsx`, the pure
  `components/updateCheck.ts`) compares that version with the one in `package.json` at build
  time, which is the newest because the release job deploys the site with every release, and
  says older, same or newer, with the direct downloads of `components/downloads.ts`. The
  version travels in the fragment, which browsers do not send to a server, so the request is
  the same for every visitor. The exported HTML is the state with no version, so the page works
  without JavaScript; it follows `hashchange`. It carries `robots` noindex and stays out of
  `sitemap.xml` (`NOINDEX_PAGES` in `scripts/sitemap.mjs`) while `overrides` still serves it at
  `/update`. The version panel links the same address in the desktop app only. The app's own
  copy of the page (the bridge serves all of `out/`) is reached by no link in the app; should it
  be shown there, it gives no verdict, since the app's copy knows only the app's own version,
  and points to the menu item. No update check at launch, no request from the main process, no
  electron-updater.
- `desktop/bridge.mjs` serves `out/` (MIME by extension, confined to `out/`, no listing) and
  `/api/agent/command`, `/api/agent/events`, `/api/agent/result` with the agentBus contract,
  behind the Host, Sec-Fetch-Site and Origin checks of `middleware.ts`. Port 3810 and no
  other: the origin holds the marks, the research acknowledgement and the agent settings, so a
  taken port shows a native dialog and the app quits, never moving to another port. Static
  files are confined to `out/` by real path, symlinks resolved.
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
  The disk image: its volume reads "CBCTScope <version>" (`dmg.title`), the architecture stays in
  the file name, and it opens on a dark window (the icon's ground `#141518`, its amber
  `#f0b43a`, the interface's light grey) saying "Drag CBCTScope to Applications" over a plain
  amber arrow from the app to the Applications link, with both names on one mid grey band. `scripts/dmg-background.mjs`, run by
  `npm run icon`, renders the committed `desktop/icon/dmg-background.png` and `@2x` (640 by
  400 points, about 9 KB and 20 KB); electron-builder joins the two into one tiff and sizes the
  window from it (electron-builder ignores `dmg.window` when a background is set, so that block
  only documents the picture's size), and `dmg.window`, `dmg.iconSize` (112) and
  `dmg.contents` (icon centres 176, 212 and 464, 212) repeat `DMG_LAYOUT`, which `tests/dmgWindow.test.ts` keeps equal.
  Finder draws the icon names itself, in black under the Light appearance and white under
  Dark, and the picture cannot know which: so each name sits on a mid grey (`#757577`, 4.57:1
  against black and 4.60:1 against white), and the test checks every pixel behind each name in
  the committed PNGs. The picture carries no version, so nothing in it goes stale.
  Notarisation in electron-builder 26.18.0 is driven by the environment: `mac.notarize: true`
  notarises when credentials are present and skips with a warning otherwise. Credentials:
  `APPLE_KEYCHAIN_PROFILE` (a local build without other credentials uses the profile
  `notary`), or `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` (the CI route), or
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. The Apple ID route passes the
  app-specific password on notarytool's command line, where other local processes can read it
  while the submission runs; the keychain profile or the API key is preferred. Signing: `CSC_LINK` and
  `CSC_KEY_PASSWORD`, or a keychain identity.
  electron-builder notarises and staples the app only; the dmg it signs (`dmg.sign: true`,
  the same Developer ID identity, skipped when there is none) is then notarised by
  `scripts/desktop.mjs` through `scripts/desktop-notarize.mjs`, with the credentials
  electron-builder chose, in its order (Apple ID, then API key, then keychain profile): for
  each dmg built, `xcrun notarytool submit <dmg> <credentials> --wait --timeout 45m
  --output-format json` (the build fails unless the status is Accepted, and names the
  submission's log command; when Apple's service does not answer within 45 minutes it fails
  saying so, and rerunning the job is safe), `xcrun stapler staple <dmg>`,
  `xcrun stapler validate <dmg>`. The built image's own signature decides: a dmg that no
  Developer ID identity signed skips it with one line, whatever the environment says.
  `node scripts/desktop-notarize.mjs --dry-run <dmg>` prints the commands the current
  environment would run, the password hidden. Stapling changes the file after
  electron-builder wrote its `.blockmap`; the app has no auto-update, so nothing reads it.
- Pipeline: `release.yml` runs a `test` job first (typecheck, lint, unit, `build:web`, the
  end-to-end suite) that every build job needs. `desktop-mac` (macos-latest: sign, notarise,
  staple; `timeout-minutes: 90`) and `desktop-win` (windows-latest, unsigned) build with `contents: read` and upload
  their dmg, zip and exe as workflow artifacts; the mac job sits behind a gate job that checks
  for `CSC_LINK`. The mac job decodes the `APPLE_API_KEY` secret (the .p8, base64) into the
  runner's temporary folder for the packaging step (written under `umask 077`, removed when
  the step ends), because notarytool reads the key from a
  file, so a missing or wrong API key now fails the job rather than shipping an image without
  a ticket; a last step runs `xcrun stapler validate` and `spctl --assess --type open
  --context context:primary-signature` on every dmg, and a step after it copies each dmg to its
  fixed name and checks each copy the same way (section 9); the Windows job copies its setup exe
  to its fixed name. One `publish` job, the only one with `contents: write`, downloads the
  artifacts and runs `gh release upload`. Signing and notarisation secrets reach the
  packaging step only. The `deploy` job needs `publish`, and its first step
  (`scripts/release-assets.mjs`) checks once that the release is GitHub's latest and that
  the three fixed installer names are attached, and fails otherwise, so the site goes live
  only once the installers are on the release the menu's links reach. A release without the
  mac secrets skips the mac job; the Windows job and `publish` still run and attach the
  Windows packages only, and `deploy` ships the site only if the macOS installers were
  attached to the release by hand; otherwise it fails before the upload and the site stays
  as it was.

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
milestone 2: the first signed and notarised build with the credentials present (the dmg's own
ticket included), a look at the dmg window under both appearances, and the first-launch test
on a clean user account.

### Milestone 3: the in-page agent

Built to the owner's decisions of 04/11/26:

- Providers: "Model server on this computer" (an OpenAI-compatible chat completions server
  with image input on loopback), listed first, then Anthropic, OpenAI and Google Gemini; the
  panel opens on "Choose a provider" with an empty model field, and a choice fills the model
  in; nothing is preselected. Presets for
  llama-server `http://127.0.0.1:8080`, Ollama `http://127.0.0.1:11434` and LM Studio
  `http://127.0.0.1:1234`; the endpoint field accepts any loopback port (current llama-server
  builds default to 9931, so the preset is a starting point, not a claim about the default).
  The panel docks as a strip under the viewer, opened from the header's Agent button, and
  pushes the viewer up rather than covering any control (hard rule 4). Closing the panel
  unmounts it; a request in flight keeps its Stop in the header beside the Agent button, and
  Switch off lives in the strip (the session lives in `agent/agentUi.ts`). Plain `fetch`, no SDKs, one adapter per
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

- Framing. A CSP delivered in a meta tag cannot carry `frame-ancestors`. The website now
  sends it as a response header (`frame-ancestors 'none'` and `X-Frame-Options: DENY`,
  section 9), so no other site may frame the published viewer. No frame-busting script is
  used.

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

1. **The pages on the site**: `manual/` beside the viewer. The Help menu opens them in a
   new tab.
2. **The help drawer in the app**: in the local app and the desktop app, the Help menu
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

## 14. The site's text pages and the files for crawlers

What the site serves to a reader without scripts and to a crawler, all static, all from the
one site address (`components/siteAddress.mjs`: `SITE_URL`, `https://cbctscope.com`, and
`CONTACT_EMAIL` beside it), nothing requested from another origin:

- **The home page before the viewer.** `app/page.tsx` is a server component: it renders the
  viewer through `components/HomeViewer.tsx` (client-only, `ssr: false`), whose loading state
  is `components/SiteIntro.tsx`, so `out/index.html` carries the heading, the three sentences
  and the links of `components/sitePages.ts` before any script runs, in the app's colours at
  full contrast. The same block is the phone page (section 7): on a phone the stylesheet
  shows its phone part and hides the loading line and the long list. The document has one
  `h1` and one `main` on every device. Without JavaScript, a `noscript` block puts the line that the viewer needs
  JavaScript and the manual does not in place of the loading line, above the same links. It
  does so with one inline style that reveals that line (it is in the intro, hidden by
  default) rather than with markup of its own: an engine that parses `noscript` as markup
  while still hiding it, as Chromium does when a test switches scripts off, applies the
  style all the same.
- **`/about`** (`app/about/page.tsx`): what CBCTScope is, who made it, how to cite it, the
  licence, the privacy summary, links to the manual and the source. **`/legal`**
  (`app/legal/page.tsx`): the legal notice (the Impressum and the disclosure under section 25
  of the Mediengesetz: name, Vienna, Austria, the site's purpose, the contact address; no
  street address), privacy, research use, licence and warranty. Both share
  `components/SitePage.tsx`; every address in them is relative, so the base path holds. In the
  local app and the desktop app the Help menu shows them in the drawer beside the viewer
  (`SITE_PAGES` in `ManualDrawer.tsx`); on the website it opens them in a new tab.
- **Cite this software.** One source, `CITATION.cff`: `lib/server/citation.ts` reads it while
  the pages render and `components/citation.ts` derives the reference line (authors, year,
  title, version, the DOI as a link) and a BibTeX entry. The Help menu's dialogue
  (`components/cbct/CiteDialog.tsx`) and the About page show both, each with a copy button
  that writes the clipboard on a click. The DOI is the one the file names: the version-bump
  commit resets it to the concept DOI and the site is built from the release tag, so every
  published build cites the concept DOI.
- **Structured data.** The home and About pages carry one JSON-LD `WebApplication`
  (`components/jsonLd.ts`): name, the site claim, category, systems, free, licence, the version
  from `package.json`, the address, the repository, the DOI, and the author as a `Person` with
  his site, ORCID and GitHub profile. No ratings, reviews or medical types. The block is a data
  block the browser never executes, so `scripts/build-web.mjs` gives it no `script-src` hash.
- **`sitemap.xml` and `robots.txt`**, written by `scripts/sitemap.mjs` after the export from
  the pages it holds (home, about, legal, every manual page; not the 404 page, the agent
  frame or the noindex update page); robots.txt allows everything and names the sitemap. **Canonical links**: one per
  page, always the production address, also in a build made under a base path (Next's
  `alternates.canonical` for the app's pages, `scripts/manual-html.mjs` for the manual's).
- **The manual's pages** take their HTML title and meta description from `pageTitle` and
  `description` in `docs/manual/manifest.json` (the question the page answers; the headings and
  chapter numbers stay in the markdown), and a footer with the author line, linking the About
  page, and links to the viewer and the legal page.

These addresses are links and identifiers, never requests: `tests/noAbsoluteUrls.test.ts` lists
each one. `tests/siteExport.test.ts` parses the export (the served text and links of the home
page, the parts of /about and /legal, the sitemap against the pages, one canonical per page, no
hash for the data block); `tests/e2e/site.spec.ts` drives the Help menu's three entries and the
page without JavaScript, with no off-origin request.
