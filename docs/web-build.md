# The web build and the packaged app

Status: design contract, milestone 1 in progress. This file is the contract for the browser
build of CBCTScope: the one served at cbctscope.com and the one inside the packaged desktop
app. It names what is built, what is forbidden, and the check that proves each claim. The
viewer's code is shared by every surface; this file describes only what differs.

## 1. Three surfaces, one code base

| surface | what runs | how scans are read | agent control |
|---|---|---|---|
| the repo (`npm run demo`, the starters) | the Next.js server on loopback plus the viewer | the server reads the opened folder in place | MCP over the loopback bridge (`mcp/server.mjs`) |
| the web build (cbctscope.com) | static files only, no server of its own; the sitemap's pages carry Vercel Web Analytics' page-view counter (section 3) | the browser reads the files the clinician opens; the scan stays in the tab | the opt-in in-page agent on the clinician's own model account (milestone 3, built) |
| the packaged app (macOS signed and notarised; Windows unsigned) | the same static build (without the counter) in a desktop shell, plus a local bridge host | the browser engine reads the opened folder | MCP over the bridge host, the same contract as the repo, plus the in-page agent |

The website ships from `main`: Vercel builds every push itself, a push to `main` becomes the
production deployment and any other branch a private preview, and GitHub's tests run alongside
as an alarm, not a gate. A tagged release builds and signs the desktop app and attaches it to the
release; it deploys nothing (section 9).

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
`basePath` from `NEXT_PUBLIC_BASE_PATH` (empty for the domain, which the site's build sets;
`/cbctscope` for a build served from a sub-path, kept working by the end-to-end suite), and `pageExtensions: ['tsx']` so that the route handlers (`route.ts`)
and `middleware.ts` are not part of the target; static export supports neither. If
`pageExtensions` does not exclude the middleware file in practice, the build script sidelines
`app/api` and `middleware.ts` for the duration of the build and restores them. The exported
HTML gets the CSP meta tag. `npm run build` for the local app is untouched.

**The page-view counter.** The site's build (`build-web --site`, section 9) writes one more tag
into each page `sitemap.xml` lists (the home page, the About, legal and questions and answers pages,
every manual page),
right after the CSP meta tag: `<script defer src="/_vercel/insights/script.js"></script>`, Vercel
Web Analytics in its documented plain-HTML form
([Web Analytics](https://vercel.com/docs/analytics/quickstart)), with no inline stub, so the
policy gains no hash. The script and its page-view request stay on the site's own origin, which
`script-src 'self'` and `connect-src 'self'` already allow. The update page (which the desktop app's **Check
for Updates** opens), the agent frame and the 404 page never carry it. `npm run build:web`
without `--site` (the desktop app's build, the end-to-end suite's) writes it nowhere, and the
local app has no export, so neither app counts anything; `npm run desktop` and
`npm run desktop:build` refuse an `out/` that holds the site's build. `scripts/site-counter.mjs` holds the tag
and the rule (a page is counted exactly when the sitemap lists it); the build refuses a page that
already refers to `/_vercel/insights/`.

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
  reads; nothing of your scan leaves this tab (in the desktop app: nothing leaves this computer, read into this app), except the
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
reading guides, the questions and answers page, the About and legal pages, the source and the
author's project page. From
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
**Legal notice**, and its **Share CBCTScope** entry (`components/cbct/ShareMenuItem.tsx`) hands the
site's name and address, never anything of the scan, to the system's share sheet where
`navigator.share` exists, and copies the address elsewhere, in the desktop app, and when the sheet
fails, saying so in the entry itself; and the About popover links the About page (section 14). While the phantom is on screen and nothing is open, the status line at the bottom
says "Your scan is read in this tab and never uploaded." and links "See CBCTScope on a real
scan" to the README's stills of a consented, bone-only real CBCT. The manual (section 13) opens from the Help menu,
the one door to it on every surface.

On a phone the web build's home page is the phone page and the viewer is never mounted: no
panes, no WebGL, and no request for the viewer's code, its WASM or a volume. The device decides,
not a window's width: `components/phone.ts` `PHONE_MEDIA` is a primary pointer that is coarse and
cannot hover, on a viewport under 600 CSS px in width or in height, so a phone gets the page in
both orientations and rotating it never mounts the viewer, while every tablet, from 600 px on
its shorter side (the iPad mini's 744 by 1133 included), gets the viewer. A mouse, a trackpad or anything that hovers never gets the phone page. The
phone page is the intro itself (`components/SiteIntro.tsx`), rendered once for every device: its
one heading, the lead, the privacy and research sentences, then a part shown on a phone only,
the manual's MPR still resized to 1200 px (`public/phone-mpr.webp`, the command beside
`PHONE_STILL` in `components/sitePages.ts`), "CBCTScope reads scans on a computer. Open
cbctscope.com there.", three full-width controls (the user manual; the release page, since a
phone cannot run the installers; "Send this link to a computer or a colleague", a `mailto:` with no recipient whose
subject and body carry the site's address, enhanced by `components/ShareLink.tsx`: where
`navigator.share` exists, a tap opens the phone's share sheet with `PHONE_SHARE`, the site's name
and canonical address, and the mail link is not followed; a cancelled sheet does nothing more,
any other failure follows the mail link, and without JavaScript or the API the link is a plain
`mailto:`. The handler is attached by React's hydration of the intro, which runs on a phone as
well, and lives in the bundled code, so the CSP needs nothing new. The page sends, stores and
copies nothing), and a row of links to the About and legal pages and the source; on a
phone the loading line and the long list of links are hidden. `app/globals.css` switches on the
same expression, character for character (`tests/phone.test.ts`), so the first paint and the
script agree. The repository's local app has no phone page.

On a computer, the desktop app included, the viewer mounts and stays mounted at every width and
zoom. The desktop app's 1024 px minimum is in screen points and zoom shrinks CSS pixels, so it can
fall below 768 CSS px like a browser window. Below 768 CSS px a full-contrast notice above the
viewer says the window is too narrow to read in and to widen it or zoom out; on a coarse pointer
that cannot hover (a small tablet held upright) it says instead that the screen is too narrow
to read in upright and to turn the device sideways, `app/globals.css` choosing the wording by
those features from the first paint; the header wraps its
groups, the mode tabs may take two lines, and the status line wraps, so no control leaves the
screen. Nothing is unmounted: the open scan, the agent session and unsaved state stay.

## 8. Tests and gates

Unit (vitest): the loader against synthetic DICOM written by `tests/fixtures/dicomWriter.ts`
from the phantom (explicit VR little endian; a multiframe file, a slice-per-file series, a
single radiograph, a DICOMDIR-style tree with extensionless files); id stability across
reopen; the size-notice decision; the CSP string; the absolute-URL scan of browser code; the
page-view counter's rule and its insertion (`tests/siteCounter.test.ts`).

End-to-end (Playwright, Chromium, against `out/` on a static server): the phantom renders
(the canvas is not blank); the fixture folder opens through the directory input; every view
mode mounts; the research-use dialogue appears once; the size notice appears on a
low-threshold test build; no off-origin request happens; the two sidecar actions round-trip;
a build with the base path (`/cbctscope`, served under that prefix only) renders the
phantom, starts the assembly worker and compiles a codec WASM from under the prefix.

Budget: the first measured bundle size becomes the budget with ten percent headroom, recorded
in the test.

Gates: the existing four plus `npm run build:web` and `npm run test:e2e`; CI runs all of them
on every push to `main` and every pull request, beside Vercel's build of the same commit, not
before it (section 9). A change to the agent surface still runs `npm run mcp:smoke` against
the dev server.

## 9. The pipeline

Two things ship, each its own way:

- **The website** ships from `main` through Vercel's Git integration. Vercel builds every push
  itself from `vercel.json`; a push to `main` becomes the production deployment at
  cbctscope.com within minutes, and a push to any other branch becomes a private preview.
  GitHub does not deploy the site.
- **The desktop app** ships from a published GitHub release (`release.yml`): the tests, the
  signed installers attached to the release, and Zenodo's DOI. A release does not deploy the
  site; the site already carries what `main` carries.

GitHub's test suite (`ci.yml`) still runs on every push to `main` and every pull request, but
after the site has changed, not before: it is an alarm, not a gate. So is the check of the
public site after each production deployment (`site-check.yml`, below). A bad deploy is undone
with Vercel's Instant Rollback.

### What a push does

To `main`: Vercel installs with `npm ci`, runs `npm run build:vercel`, and serves the result as
the production deployment on cbctscope.com. If Vercel is still building an earlier commit on the
branch, the new push waits, and of several waiting pushes only the newest is built
([vercel.com/docs/git/vercel-for-github](https://vercel.com/docs/git/vercel-for-github), "A
Deployment for Each Push"). At the same time GitHub runs `ci.yml` and CodeQL, and once the
deployment is live, `site-check.yml`.

To any other branch: a preview deployment of that branch at its own `vercel.app` address,
behind Deployment Protection, so only members of the Vercel team can open it. Nothing on
cbctscope.com changes. Branches Dependabot opens (`dependabot/**`) get no deployment
(`vercel.json`, below); their pull requests still run `ci.yml`.

A preview and the production deployment of one commit are two builds of it, so their files are
not byte for byte the same (Next names each build with a fresh id). What holds is narrower: no
Vercel variable changes a page, because the build sees none of them; the page carries no base
path and no text that depends on where it is served; and the layout's headers are the same for
both, `X-CBCTScope-Commit` included.

**Consequences.**

- The tests come after. A commit that breaks the site is live until a human acts on the red
  run: roll back in Vercel, then fix forward on `main`.
- `main` must always be fit to publish. Unfinished work stays on a branch, where its preview
  shows it; it reaches `main` when it is ready for every visitor.
- On a version bump, the site names the new version (on its update page, in its citation line
  and its structured data) from the moment the bump reaches `main`, before the release run
  has built and attached that version's installers. Until then the download menu, which links
  through `/releases/latest/download/<name>`, still gives the previous release's installers,
  and the update page tells an installed app of the previous version that a newer one exists
  that it cannot download yet. Keep that window short: bump the version, then publish its
  release at once. An installed app's **Check for Updates…** compares against what the site
  names.
- The site may be ahead of the installed apps at any time: its pages, manual and viewer carry
  whatever `main` carries. A change the desktop app should carry waits for a release.
- Vercel, not GitHub, now holds the record of what was live when: its Deployments page lists
  every production deployment with its commit.

### Rollback

On the project's overview page in Vercel, the Production Deployment tile has an **Instant
Rollback** button; it lists the deployment that is live and those it can return to (on the Pro
plan, **Choose another deployment** lists every deployment that was ever production), then
**Continue** and **Confirm Rollback**. The same is in the Deployments tab, from the menu (⋮) of
a deployment row. The domain points at the chosen deployment at once
([vercel.com/docs/instant-rollback](https://vercel.com/docs/instant-rollback)).

After a rollback Vercel stops assigning the production domain to new deployments: a push to
`main` builds but does not go live until the rollback is undone. To undo it, press **Manage**
on the Production Deployment tile, choose the deployment to promote (normally the one with the
fix), and **Confirm**; from then on a push to `main` goes live again (same page, "Undo a
rollback").

### The build on Vercel

`vercel.json` holds four settings and nothing else:

| key | value | what it does (Vercel's documentation) |
|---|---|---|
| `framework` | `null` | selects the framework preset "Other", so Vercel applies no Next.js preset ([vercel.json, framework](https://vercel.com/docs/project-configuration/vercel-json#framework)) |
| `installCommand` | `npm ci` | the install, from the committed lockfile ([vercel.json, installCommand](https://vercel.com/docs/project-configuration/vercel-json#installcommand)) |
| `buildCommand` | `npm run build:vercel` | the build ([vercel.json, buildCommand](https://vercel.com/docs/project-configuration/vercel-json#buildcommand)) |
| `git.deploymentEnabled` | `{"dependabot/**": false}` | no deployment for a branch matching the pattern, in minimatch syntax; every other branch deploys ([Git configuration](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled)) |

`.vercelignore` holds two lines: `/middleware.ts` and the test that imports it. Vercel deploys a
middleware file at the root of a repository as Routing Middleware, whatever the build command
wrote, and this one is the local app's loopback guard: left in, it answers every address of the
site with an error. Nothing else at the root may become code on Vercel (no `api/` folder, no
other middleware or proxy file); `tests/siteDeploy.test.ts` pins that. Only a preview shows
what Vercel adds around the build's output, which is why the owner's setup checks one before
the first merge.

`npm run build:vercel` is `node scripts/build-web.mjs --site && node scripts/vercel-output.mjs`,
and runs the same on any machine:

1. `build-web --site` prints the Node.js version, then builds `out/` for the root of the domain,
   with the page-view counter in the sitemap's pages (section 3), and with the environment of
   `scripts/site-env.mjs`: `NEXT_PUBLIC_BASE_PATH` empty, Next's
   telemetry off, the low-threshold build's variables dropped, and every variable whose name
   starts with `VERCEL`, `NEXT_PUBLIC_VERCEL` or `NOW_` removed. Next 15 reads `VERCEL_ENV`,
   `VERCEL_URL`, `VERCEL_BRANCH_URL` and `VERCEL_PROJECT_PRODUCTION_URL` while it renders
   metadata (a preview's address as the social-image base, a `crossorigin` on the manifest link
   in a preview), so without this a preview's pages could differ from production's;
   `tests/siteDeploy.test.ts` scans Next's metadata code for every such variable.
2. `vercel-output.mjs` lays `out/` out in the Build Output API v3 form at the project root:
   `.vercel/output/static/` is a byte copy of `out/`, and `.vercel/output/config.json` holds the
   routes, the overrides and the 404 route below. A build command that writes this folder
   defines the deployment itself ([Build Output API](https://vercel.com/docs/build-output-api):
   it is written "as the output of their build command"); no output directory is set.

The install brings in the whole dependency tree, desktop tooling included, because the web
build needs dev dependencies (TypeScript, `marked`, `rolldown`). Nothing in it downloads a
large binary: Electron 45 fetches its binary on first use, not on install, and Playwright
downloads browsers only when told to (`npx playwright install`); `tests/siteDeploy.test.ts`
fails if either package gains an install step. `sharp` installs its prebuilt Linux binary, as
on GitHub's runners.

**Node.js.** Vercel's available versions are 26.x (the default), 24.x and 22.x. The project
setting (Settings, Build and Deployment, Node.js Version) is overridden by `engines` in
`package.json`, which takes a semver range and deploys the newest available major inside it
([Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)).
`engines` is `>=22 <27`, so today the site builds on the latest Node.js 26.x, while GitHub tests
and the desktop builds use 22; a build of the web target on Node.js 26.8.2 wrote the same
JavaScript chunks, byte for byte, as one on 22.22.3, and the build log's first line names the
version used. The upper bound keeps a new major from arriving on Vercel unannounced: when
Vercel offers Node.js 27, the site stays on 26 until `engines` is raised, and raising it is a
deliberate change, made with a build on that major. Pinning 22.x would need `engines` at `22.x`,
which makes `npm` warn (`EBADENGINE`) for everyone running the repository on a newer Node; the
bound does the same from Node.js 27 on, a warning, not a refusal.

**On GitHub.** The `web` job of `ci.yml` runs `npm run build:vercel` after the end-to-end suite
and fails unless `.vercel/output/config.json` exists with version 3 and
`.vercel/output/static/index.html` exists, so the build command Vercel runs is exercised on
every push and pull request, and then runs `tests/siteExport.test.ts` again on that site build.

### What `config.json` sets

- Response headers on every address, on top of the page's own CSP meta tag, which stays
  exactly as `build-web` writes it, because it also protects the desktop app:
  `Content-Security-Policy: frame-ancestors 'none'` (a second policy that only adds the one
  directive a meta tag cannot carry), `X-Frame-Options: DENY` (the same for browsers without
  CSP level 2) and `X-Content-Type-Options: nosniff` (each file is used only as the type it is
  served with). The agent frame is the one page the site frames itself, so it gets
  `frame-ancestors 'self'` and `SAMEORIGIN`. No Referrer-Policy is set: outbound links keep
  the browser's default and carry the origin. When the build has a commit in
  `VERCEL_GIT_COMMIT_SHA` (Vercel sets it in every build from Git,
  [System environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)),
  every address also answers with `X-CBCTScope-Commit: <sha>`, the public trace of which
  deployment is live, which the check after a deploy waits for. The pages never carry it.
  These headers are defined in `scripts/vercel-output.mjs` and nowhere else.
- Addresses: Next writes `about.html`, `legal.html`, `online-cbct-viewer.html` and `update.html`;
  `overrides` serves them at `/about`, `/legal`, `/online-cbct-viewer` and `/update`, their
  canonical addresses, without a redirect. The manual keeps its `.html`
  addresses as the sitemap lists them, so a blanket `cleanUrls`, which would redirect them,
  is not used. `/` and `/manual/` are their folders' `index.html`.
- A miss answers 404 with the export's `404.html` (an error-phase route).

The host's own request statistics are the only visitor numbers; no script runs in the page
to count anyone.

### The check after a deploy

`site-check.yml`, named **Site check**, runs on the `deployment_status` event that Vercel's
GitHub integration sends as a deployment changes state
([vercel.com/docs/git/vercel-for-github](https://vercel.com/docs/git/vercel-for-github),
"Silence deployment notifications on pull requests"). The same page describes
`repository_dispatch` events (`vercel.deployment.success`, `.error`, `.promoted` and others) and
recommends them over `deployment_status`, but it names only the deployment's `url` and
`environment` in their payload and points to a schema outside the documentation, so the
deployment's commit in that payload is not confirmed there; the workflow stays on
`deployment_status`, whose payload GitHub documents with the deployment's `sha` and
`environment`. Every deployment, preview or production, sends several statuses (pending, then
success or failure), and each starts a run of this workflow, so the Actions tab lists runs
whose jobs were all skipped: that is expected noise. Two jobs do something:

- `live` runs when the status is `success` and the deployment's GitHub environment starts with
  `Production` (GitHub's `startsWith` ignores case), or when the workflow is started by hand
  from the Actions tab.
- `failed` runs when a production deployment's status is `failure` or `error`, and fails with
  one line naming the commit: the build broke, and the site still serves the deployment before
  it.

Both have read-only permissions, name no secret and install nothing. `live` runs
`node scripts/site-check.mjs --live --commit <sha>`, with the commit of the event
(`github.event.deployment.sha`; GitHub checks out that commit for a `deployment_status` run, so
the script and `package.json` are the deployed commit's), against the public
`https://cbctscope.com`:

1. It asks the home page every 15 s, up to 20 times, until `X-CBCTScope-Commit` names that
   commit, so it never checks the deployment before; then every address it reads must carry
   that commit.
2. Every address in the live `sitemap.xml`, and the fixed files `LIVE_FILES` (robots.txt, the
   sitemap, `llms.txt`, both icons, `favicon.ico`, the share image `og-card.png`, `/update`, the agent frame, the manual's
   index), answers 200 with no redirect, the Content-Type its extension needs (an extensionless
   page or a folder is HTML) and the layout's headers above; `/this-address-does-not-exist`
   answers 404 with the body of `/404.html`.
3. Every script and stylesheet a page references (`<script src>`, `<link rel="stylesheet">`, a
   preload of a script or style) is on the site's own origin and answers 200 with its type and
   headers.
4. Every page the live sitemap lists carries the page-view counter's tag (section 3) exactly
   once and no other reference to `/_vercel/insights/`; no other page it reads (`/update`, the
   agent frame, the 404 answer and `/404.html`) carries any. `/_vercel/insights/script.js`
   answers 200 with a JavaScript type, which proves Web Analytics is enabled in the Vercel
   project; when it is not, the check fails and says to enable it.
5. No page, as an anonymous visitor gets it, carries any other marker of Vercel's Web Analytics,
   or one of Speed Insights or the toolbar (`FORBIDDEN_MARKERS`, each taken from Vercel's
   documentation: `/_vercel/speed-insights/`, the `window.vaq` and `window.siq` queues of their
   inline snippets, the `@vercel/analytics` and `@vercel/speed-insights` packages, and
   `https://vercel.live`, the toolbar's host). This proves the Web Analytics stub and the
   speed-insights script are not in the served pages. It does not prove the toolbar is off: the
   toolbar is shown to signed-in members of the team, and the check fetches as nobody; the
   toolbar setting (setup, step 6) is what keeps it off.
6. The update page says "The newest version of CBCTScope is <version>." for the version in
   `package.json`.

A run that finds problems is repeated twice, 15 s apart; the last run decides, and its problems
are listed one per line.

What the owner sees, case by case:

- **A good deploy**: a **Site check** run whose `live` job passes, a few minutes after the push.
- **A failed build**: a run whose `failed` job is red, naming the commit; the site is unchanged.
  Whether Vercel reports a broken build as `failure` or as `error` is not stated in its
  documentation, so the job takes either.
- **A preview**: runs with every job skipped.
- **A rollback in force**: each later push to `main` still builds and reports success, but
  Vercel does not assign it to the domain, so `live` waits five minutes for a commit the site
  does not serve and fails, saying the site still serves another commit. That red run is the
  reminder that the rollback is still in force (Rollback, above).
- **Two deploys close together**: the workflow's concurrency group cancels a `live` job still
  waiting when the next production deployment's check starts; runs that check nothing (and
  `failed`) each get a group of their own, their run id, so they never cancel a check
  ([workflow syntax, `concurrency`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)).
  A run started by hand shares the group with production checks.
- **A re-run of an older Site check**: it waits for a commit the site no longer serves and fails
  by design. It cannot compare bytes with a build of its own: Vercel builds each
commit itself, and no two builds of the web target are byte-identical (Next names each build
with a fresh id), so it checks what any visitor gets instead. `tests/siteExport.test.ts` runs
items 2 to 6 against the local export in every CI run (item 4 on each flavour of the export, and
the run states which it expects: no page with the counter after a plain `npm run build:web`,
exactly the sitemap's pages after the site build, with `CBCTSCOPE_EXPORT=site`), so a change that would fail the live
check fails a test first.

The live mode also checks a preview: `--base <url>` names the deployment's own address, the
sitemap's production addresses are read as paths on it (the output says so), and the secret of
Protection Bypass for Automation, read from `VERCEL_AUTOMATION_BYPASS_SECRET` in the environment
and never from an argument, goes in the `x-vercel-protection-bypass` header
([Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation));
it is never sent to the public site and never printed.

The byte mode of the same script, `node scripts/site-check.mjs --base <url> --out out`, stays
for an export on disk served with the layout's headers (for instance a prebuilt deployment
made by hand from it): every file and sitemap address served byte for byte, with its type and
headers, and the 404. The secret of Protection Bypass for Automation, in
`VERCEL_AUTOMATION_BYPASS_SECRET`, reaches a protected deployment address.

### The release

`release.yml` runs on `release: published`, every action pinned to a commit SHA:

1. `test`: typecheck, lint, unit, the web build, the tests that read the export, the
   end-to-end suite.
2. In parallel after it: `desktop-win`, and `desktop-gate` then `desktop-mac` (signs,
   notarises and staples the app and the dmg, section 12; skipped without the signing
   secrets).
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
4. `installers`, after `publish`, whenever `publish` succeeded and the run was not cancelled
   (its own `if:`, because GitHub skips a job with the implicit success condition when any job
   up its chain was skipped, as the mac job is without signing secrets,
   [workflow syntax, `needs`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)):
   `node scripts/release-assets.mjs` reads, once, GitHub's
   latest release (the job's read-only token, the REST API) and fails unless it is this
   release, then reads this release's asset list and fails, naming each missing file, unless
   the three fixed names are attached as finished uploads. The list is what counts, so files
   attached by `publish` and files attached by hand pass alike. A prerelease, a release
   published with "Set as latest release" unticked, or one without its macOS installers turns
   the run red, because the menu's links would lead to another release or to missing files.
   It gates nothing: the site is not deployed by this workflow. To recover from missing files,
   attach them to the release, then use **Re-run failed jobs** on that run. The names are
   `REQUIRED_ASSETS` in the script; `tests/downloads.test.ts` fails if they differ from
   `components/downloads.ts`.

On release day a human checks, in a browser, that the release carries the six installer files
(three versioned, three fixed) and that each of the menu's three direct links starts the
download of the file it names.

The site's citation does not depend on the release: its version line names the version in
`CITATION.cff`, bumped with `package.json`, and its DOI is always the concept DOI, which resolves to the newest archived
version (section 14, Cite this software). The site is built from `main`, whose
`CITATION.cff` names that version's DOI after the DOI-pin commit, and can serve newer pages
and viewer code than that archive holds, so the site never cites a version DOI.

### The owner's one-time setup

The order matters: the build command is set first, so nothing without this arrangement can
deploy; then the repository is connected, this arrangement is checked on a preview, and only
its merge to `main` makes the first production deployment from Git.

1. Vercel, the existing project `cbctscope`: open **Settings** in the sidebar, then **Build and
   Deployment**. Under **Framework Settings**, turn on the **Override** toggle of **Build
   Command** and enter `npm run build:vercel`, then save
   ([Configuring a Build](https://vercel.com/docs/builds/configure-a-build), "Build Command").
   Connecting the repository may start a build of `main` at once, and `main` has no
   `vercel.json` until this arrangement is merged; with the project's own settings such a build
   could publish a wrong site over the live one. With this override, a commit that lacks the
   `build:vercel` script fails to build and deploys nothing. The same holds for every older
   branch and commit, previews included. A commit that carries `vercel.json` uses its
   `buildCommand`, which overrides the setting.
2. **Settings**, **Git**: under **Connected Git Repository**, connect the GitHub repository
   `rezamotaghi/cbctscope` (the Git section of the Project Settings connects or disconnects a
   repository, [vercel.com/docs/git/vercel-for-github](https://vercel.com/docs/git/vercel-for-github)).
   If the repository is not offered, give the Vercel GitHub App access to it: on GitHub,
   **Settings**, **Applications**, **Installed GitHub Apps**, **Configure** next to Vercel, then
   under **Repository access** add the repository and **Save** (same page, "Missing Git
   repository"). What this grants: the Vercel GitHub App's repository permissions as that page
   lists them, read and write on Administration, Checks, Contents, Deployments, Pull Requests,
   Issues, Web Hooks, Commit Statuses and Workflows, read on Metadata and Actions, plus read on
   the organisation's Members and the user's email addresses. Write on Contents and Workflows
   means the app can change the repository's code and its workflow files.
3. **Settings**, **Environments**: click the **Production** environment and go to **Branch
   Tracking**; the branch must be `main` (change it and **Save** if not;
   [vercel.com/docs/git](https://vercel.com/docs/git), "Customizing the production branch").
4. **Settings**, **Build and Deployment**: the **Node.js Version** setting has no effect while
   `engines` holds a range (above); leave it.
5. **Settings**, **Git**: under **Connected Git Repository**, switch the bot's comments off
   ([Silence GitHub comments](https://vercel.com/docs/git/vercel-for-github#silence-github-comments);
   its `vercel.json` key `github.silent` is deprecated, so the setting lives here). Leave the
   **deployment_status Events** control on: the check after a deploy runs on those events.
6. **Settings**, **General**, **Vercel Toolbar**: set **Pre-Production Deployments** and
   **Production Deployments** to **Off**, and the same in the team's **Settings**, **General**,
   **Vercel Toolbar** if the team default is on
   ([Managing the toolbar](https://vercel.com/docs/vercel-toolbar/managing-toolbar)). In the
   project's **Analytics** tab, enable **Web Analytics**, and do it before the deploy that first
   carries the counter's tag (section 3): Vercel adds the routes under `/_vercel/insights/` with
   the next deployment after it is enabled, and until then the tag's script answers 404 and the
   check after a deploy fails
   ([Web Analytics](https://vercel.com/docs/analytics/quickstart)). Leave **Speed Insights**
   off: it needs a script in the page, which the site does not carry.
7. **Settings**, **Deployment Protection**: keep **Standard Protection** (every deployment
   protected except the production domains) with **Vercel Authentication**, so a preview opens
   only for members of the team
   ([Deployment Protection](https://vercel.com/docs/deployment-protection)). Under **Protection
   Bypass for Automation**, make sure a secret exists (step 9 needs it once). Vercel sets that
   secret as `VERCEL_AUTOMATION_BYPASS_SECRET` in every deployment, the build included
   ([Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation),
   [System environment variables](https://vercel.com/docs/environment-variables/system-environment-variables)),
   so every install script `npm ci` runs can read it; the site's own build does not see it
   (`scripts/site-env.mjs`).
8. **Settings**, **Environment Variables**: keep **Enable access to System Environment
   Variables** ticked; without it the build has no `VERCEL_GIT_COMMIT_SHA`, the site answers
   without `X-CBCTScope-Commit`, and the check after a deploy fails waiting for it.
9. Push the branch that carries this arrangement. On the project's **Deployments** page, open
   its preview deployment and copy the deployment's own address. From a checkout of the
   branch, with the secret from step 7 in the environment for this one command:

   ```sh
   VERCEL_AUTOMATION_BYPASS_SECRET=<secret> node scripts/site-check.mjs --live \
     --base https://<the deployment's address> --commit "$(git rev-parse HEAD)"
   ```

   It must end with "answers all ... addresses": every page with `frame-ancestors 'none'`,
   `X-Frame-Options: DENY` and `nosniff`, the agent frame with `frame-ancestors 'self'` and
   `SAMEORIGIN`, `X-CBCTScope-Commit` equal to the branch head on every address, the right
   types, same-origin assets, the 404, and the version on the update page. Then open the
   preview in a browser for the viewer and the manual. Its build log starts with the Node.js
   version.
10. Merge it to `main`. Vercel builds the production deployment; once it is ready, the **Site
    check** run for it must pass. Its first run also confirms the name of the GitHub
    environment Vercel reports production deployments under: if `live` is skipped although
    the deployment succeeded, the name does not start with `Production`; read it on the
    repository's **Deployments** page and correct the jobs' conditions and the concurrency
    group.
11. Then clean up. Delete the two GitHub environments no workflow uses, `production` and
    `rehearsal`: on the repository's **Settings**, **Environments**, the trash icon next to each
    (**Delete environment**), then **I understand, delete this environment**. Deleting an
    environment deletes its secrets, which are the four Vercel secrets (`VERCEL_TOKEN`,
    `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_AUTOMATION_BYPASS_SECRET`); check under
    **Secrets and variables**, **Actions** that none of the four is left as a repository
    secret. Revoke the access token in the Vercel account's Tokens page. In Vercel, regenerate
    the Protection Bypass for Automation secret, since it was in a shell and is readable by
    every build's install scripts, or delete it when no further preview check is planned;
    regenerating or deleting it invalidates the value earlier deployments carry (same page).
    The five Apple repository secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`,
    `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`) stay: the release signs and notarises with them.

The Apple secrets, for a new machine or a renewed certificate, are repository secrets
(Settings, Secrets and variables, Actions), because the macOS job runs in no environment:

- `CSC_LINK`: the Developer ID Application certificate, exported from Keychain Access, My
  Certificates, as a .p12, then base64 on one line: `base64 -i devid.p12 | tr -d '\n'`.
- `CSC_KEY_PASSWORD`: the password chosen for that export.
- `APPLE_API_KEY`: an App Store Connect API team key with Developer access, the .p8 file
  Apple lets you download once, base64 on one line the same way.
- `APPLE_API_KEY_ID`: that key's Key ID.
- `APPLE_API_ISSUER`: the team's Issuer ID.

The key can be checked before it is stored: `xcrun notarytool history --key <file.p8>
--key-id <id> --issuer <issuer>` lists past submissions when the key works. Without
`CSC_LINK` the macOS job is skipped and the release carries no macOS installers, so its
`installers` job fails until they are attached by hand. A wrong or missing API key fails the
macOS job, so `publish` does not run.

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
  in the page. Vercel builds and publishes the site from `main` through its Git integration
  (section 9).
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
  time, the version `main` carries, which is the latest release's except between a version bump
  and its release (section 9), and
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
  `app/icon.svg` and `app/apple-icon.png`, and `public/favicon.ico` (the tile at 16, 32 and 48 px), which
  no page links: it answers whatever asks for that address by name.
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
  packaging step only. The `installers` job needs `publish` and runs
  `scripts/release-assets.mjs`, which checks once that the release is GitHub's latest and that
  the three fixed installer names are attached, and turns the run red otherwise, because the
  menu's links reach that release. The release deploys nothing; the site ships from `main`
  (section 9). A release without the mac secrets skips the mac job; the Windows job and
  `publish` still run and attach the Windows packages only, and `installers` fails unless the
  macOS installers were attached to the release by hand.

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
  street address), privacy, research use, licence and warranty. **`/online-cbct-viewer`**
  (`app/online-cbct-viewer/page.tsx`): the questions and answers page, twelve questions about
  opening and reading a scan, each an `h2` with a short answer taken from the manual and a link
  to the manual page that covers it, from one array (`components/siteQuestions.ts`) that also
  gives the page's FAQPage JSON-LD; the home page's list and the About page link it. All three share
  `components/SitePage.tsx`; every address in them is relative, so the base path holds. In the
  local app and the desktop app the Help menu shows About and the legal page in the drawer beside the viewer
  (`SITE_PAGES` in `ManualDrawer.tsx`); on the website it opens them in a new tab.
- **Cite this software.** From `CITATION.cff` and the concept DOI: `lib/server/citation.ts`
  reads the file while the pages render and `components/citation.ts` derives the reference
  line (authors, year, title and version from the file, the concept DOI as a link) and a
  BibTeX entry. The Help menu's dialogue
  (`components/cbct/CiteDialog.tsx`) and the About page show both, each with a copy button
  that writes the clipboard on a click. The version line names the version the site carries,
  the one `main` carries (in the desktop app, the app's own), and the DOI is always the concept DOI (`CONCEPT_DOI` in
  `components/links.ts`), which resolves to the newest archived version, whatever the file's
  `doi:` holds: the site, built from `main`, can serve newer code than one version's archive
  (section 9).
  `CITATION.cff` keeps its own ritual for GitHub and Zenodo (the concept DOI at the version
  bump, the version DOI pinned after the release).
- **Structured data.** The home and About pages carry one JSON-LD `WebApplication`
  (`components/jsonLd.ts`): its `@id` (`https://cbctscope.com/#software`), name, the site claim,
  category, systems, free (and a zero-price offer), licence, the version from `package.json`,
  the address, the installers' fixed addresses, the manual as its help, the manual's MPR still
  (`phone-mpr.webp`) as its screenshot, the eight reading modes by the manual's names as its
  features, the repository, the author's project page and the DOI address as `sameAs`, the
  concept DOI, and the author as a `Person` with the `@id` of his own site's record
  (`https://rezamotaghi.com/#person`), his name with its prefix, his title, his site, ORCID and
  GitHub profile. The home page adds a `WebSite` record (`https://cbctscope.com/#website`). No ratings, reviews or medical types. The questions and
  answers page carries one JSON-LD `FAQPage` instead, its questions and answers as the page
  shows them. Each block is a data block the browser never executes, so `scripts/build-web.mjs` gives it no `script-src` hash.
- **`llms.txt`**, written by `scripts/llms-txt.mjs` after the export, in the format of
  [llmstxt.org](https://llmstxt.org): an H1 with the name, a blockquote with the README's claim,
  one paragraph (where it runs, the share card's privacy line, the research-use sentence), then
  sections of links with a note after each: the site's pages with the title and description
  each exported page carries, the manual's index and every page with its manifest title and
  description, the source, the concept DOI and the author's project page. Every address is the
  production one. It is a text file, not a page: the sitemap does not list it and the counter
  is never written into it.
- **`sitemap.xml` and `robots.txt`**, written by `scripts/sitemap.mjs` after the export from
  the pages it holds (home, about, legal, the questions and answers, every manual page; not the 404 page, the agent
  frame or the noindex update page); robots.txt allows everything and names the sitemap. **Canonical links**: one per
  page, always the production address, also in a build made under a base path (Next's
  `alternates.canonical` for the app's pages, `scripts/manual-html.mjs` for the manual's).
- **The manual's pages** take their HTML title and meta description from `pageTitle` and
  `description` in `docs/manual/manifest.json` (the question the page answers; the headings and
  chapter numbers stay in the markdown), and a footer with the author line, linking the About
  page, and links to the viewer and the legal page. Each head also carries the share card's Open
  Graph and Twitter tags (the page's title, description and address, `og:type` article, the
  site's `og-card.png` as an absolute address with its size) and one JSON-LD data block: the
  page as a `TechArticle` (headline, description, address, language, the author by the `@id` of
  his own site's Person record, part of the manual, about the viewer's `@id`), the index as the
  manual's `CollectionPage`, and a `BreadcrumbList` (CBCTScope, User manual, the page). No
  dates. The block is never executed, so `build-web` gives it no hash; nothing visible changes.

These addresses are links and identifiers, never requests: `tests/noAbsoluteUrls.test.ts` lists
each one. `tests/siteExport.test.ts` parses the export (the served text and links of the home
page, the parts of /about, /legal and /online-cbct-viewer, the sitemap against the pages, one canonical per page, no
hash for the data block); `tests/e2e/site.spec.ts` drives the Help menu's three entries and the
page without JavaScript, with no off-origin request.
