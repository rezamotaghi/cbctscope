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
blockquotes. No em dashes. No screenshots with real patient data, ever; if a
chapter needs an image, capture the synthetic phantom.
