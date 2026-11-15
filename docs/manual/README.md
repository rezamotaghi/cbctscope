# The user manual (maintainers' note)

This directory is the CBCTScope user manual: chaptered markdown, ordered by
`manifest.json`. The per-mode reading guides in `docs/reading-modes/` double as
chapters 8.1 to 8.8; they are referenced, never duplicated. The manual is a
product deliverable: it will later ship as an in-app help menu and as a
standalone PDF, both built from these same files in manifest order. The first
exists: `scripts/manual-html.mjs` renders these files into static pages at build
time (`manual/` on the website, the help drawer in the app; docs/web-build.md,
section 13). Nothing generated is committed; the markdown here stays the source.

**Keeping it true is part of the definition of done.** Any change that alters
what a user sees or does (a control, a gesture, a hotkey, a mode, an MCP verb,
an export format, an error message) updates the affected chapter in the same
commit. `tests/manual.test.ts` drift-checks the enumerable surface against the
source code (view modes, tool palette, window presets, MCP verbs, the manifest,
the version line), so the repo gates fail when those go stale; prose accuracy
is on the author of the change. See AGENTS.md, "The user manual".

Style: professional manual register, imperative voice. **Bold** marks a UI
element, `code` marks something typed or a key. Notes and cautions are
blockquotes. No em dashes. Each reading-mode guide opens with an **At a
glance** blockquote (the question, how to start, three gestures, when to leave
the mode), then its still, then a gestures table and the controls; the drift
test pins the card and the still. Chapter images default to the synthetic
phantom; a real scan may appear only under the consent and de-identification
standard in AGENTS.md, hard rule 3.

Stills live in `docs/media/manual/` as WebP (a quarter of the PNG bytes at
twice the resolution; GitHub and every current browser render it), captured by
`scripts/manual-shots.mjs` over the DevTools protocol in a headless Chrome at
1600 by 913 CSS pixels, device scale 2: `header.webp` shows the header on the
phantom with the numbered callouts that match the list in chapter 3;
`mode-<mode>.webp` shows each mode on the consented, de-identified real CBCT
that the README stills also use (AGENTS.md hard rule 3: bone-only 3D, the
cephalogram as densest-only MIP so no soft-tissue profile is projected). The
script's header at the top documents the run. The per-volume parameters for
the real CBCT live beside that volume, outside the repo, in
`manual-shots-v2.json` (`--params`). They hold no screen coordinates: slice
levels are the pane's own count, and every point is a fraction of the image in
a numbered pane (`node scripts/manual-shots.mjs measure` lists the panes), so
a layout change needs no recalibration. The older `manual-shots.json` beside
it carries CSS pixels of the v1.6 layout and no longer fits the script.
Recapture after any change to the header or to a mode's layout, in the same
commit as the change.

The website's stills come from the static export, which has no agent API, so
the script drives that page over the DevTools protocol only: run
`npm run build:web`, serve it with `node scripts/serve-out.mjs out <port>`,
then `node scripts/manual-shots.mjs site download --url
http://127.0.0.1:<port>/`. `site.webp` is the first screen a first-time
visitor sees on the phantom; `download-menu.webp` is the same screen with the
header's **Download the desktop app** menu open. The desktop app's two stills
are real window captures made on a Mac, not script output: `desktop-app.webp`
(the window on the consented CBCT, bone-only 3D) and `disk-image.webp` (the
disk image's Finder window), each a PNG converted to sRGB and encoded with
all metadata stripped, the transparent ground and shadow kept:

```sh
sips -m "/System/Library/ColorSync/Profiles/sRGB Profile.icc" window.png --out window-srgb.png
cwebp -q 82 -m 6 -alpha_q 100 -metadata none [-resize <half width> <half height>] window-srgb.png -o docs/media/manual/<name>.webp
```

`-resize` halves a full Retina capture (the app window); the disk image
window is kept at its own size. `tests/manual.test.ts` fails when a still in
`docs/media/manual/` is embedded by no page, or a page embeds one that is
missing.

The README media come from the same script and the same parameter file, run
against `npm run dev` with the real CBCT open: `node scripts/manual-shots.mjs
thumbs --params <file>` writes the four `docs/media/thumb-*.png` (1600 by 914,
device scale 1), and `node scripts/manual-shots.mjs gif --params <file>` drives
the agent demo's beats with the agent verbs and encodes
`docs/media/cbctscope-demo.gif` (960 by 548, 31 frames). The gif plan needs
ffmpeg on the PATH (`brew install ffmpeg` on macOS) and says so when it is
missing; its frames live in the OS temp folder and are deleted after encoding.
Re-run both whenever the header or a mode they show changes.
