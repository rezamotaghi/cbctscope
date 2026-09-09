# The user manual (maintainers' note)

This directory is the CBCTScope user manual: chaptered markdown, ordered by
`manifest.json`. The per-mode reading guides in `docs/reading-modes/` double as
chapters 8.1 to 8.8; they are referenced, never duplicated. The manual is a
product deliverable: it will later ship as an in-app help menu and as a
standalone PDF, both built from these same files in manifest order. Until those
builds exist, the manual is read here.

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
script's header at the top documents the run. Recapture after any change to
the header or to a mode's layout, in the same commit as the change.
