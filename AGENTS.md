# AGENTS.md

Guidance for AI agents and contributors working in this repo. Read fully before non-trivial changes.

## What this is

CBCTScope: a complete, local-first CBCT and 2D radiograph viewer (Next.js + Cornerstone3D), built by a board-certified oral and maxillofacial radiologist, and the first with native AI-agent control over MCP. Research software; not a medical device.

## Hard rules

1. **The MDR fence is structural.** No tool, endpoint, or UI feature may return findings, interpretations, or diagnoses, and the MCP verb surface stays navigation/visualization only, with no code execution. A change that crosses this line is rejected regardless of usefulness; it would turn the software into a diagnostic device.
2. **Local-first, forever.** No hosted instance, no telemetry, no uploads. Scans are read in place; file paths never leave the server process; the only disk writes are the annotation sidecars in the app-data folder (labels, world-mm coordinates, HU statistics; never pixels).
3. **Never commit imaging.** No DICOM files, no scan data, anywhere in history: scans are read in place and stay on the operator's own disk. `.gitignore` blocks `*.dcm` as a backstop. The repo's image content is the synthetic phantom (`lib/server/phantom.ts`) plus the interface stills in `docs/media/`. A still may show a real scan only when all of these hold: the patient gave written consent; the volume was de-identified before it was first opened (identifying tags removed, every date blanked, UIDs regenerated, no burned-in text, verified by re-reading the written files); and the folder name carries no identity, because the viewer shows it as the case label. Never publish a soft-tissue 3D render of a real head: that surface is a recognizable face. Bone renders are fine, and are what the stills use.
4. **UI clarity beats minimalism.** Controls stay fully visible at full contrast at all times: never dim, hide, or hover-reveal a control. This is a reading environment.
5. **No em dashes in README or docs.** Restructure with a colon, comma, or period.

## Layout

- `app/` Next.js app router: the single reading screen plus `/api/cbct/*` (volume sources) and `/api/agent/*` (the MCP bridge: SSE command channel + result round-trip).
- `components/cbct/` the viewer: `CbctApp` (shell/state), `CbctViewport` (MPR + 3D), one component per reading mode, and pure math modules (`curvedReformat`, `stitch`, `regionGrow`, `oblique`, `render3d`, ...).
- `lib/server/` volume sources: `localSource` (user-opened exports, read in place), `fused` (session stitches, memory only), `phantom` (synthetic demo), `dicom` (shared contract), `agentBus` (command bus), `config` (app-data paths).
- `mcp/` the stdio MCP server (`server.mjs`, a thin proxy onto `/api/agent/command`) plus its `package.json` and MCPB `manifest.json` for the one-click bundle (`npm run mcpb`, built by `scripts/mcpb.mjs`); `skills/cbctscope-reading/` the Agent Skill that teaches a host the verbs.
- `scripts/demo.mjs` the cross-platform `npm run demo` launcher; `scripts/mcp-smoke.mjs` the live MCP check; `Start CBCTScope.command` / `Start CBCTScope.bat` at the root are the double-click starters (install on first run, normal mode, open the browser).
- `tests/` vitest on the pure math + the manual drift test; `docs/` MCP contract, per-mode reading guides, and the user manual (`docs/manual/`, see below).

## The user manual

`docs/manual/` is the product manual: chaptered markdown ordered by `manifest.json`, with
the reading-mode guides doubling as chapters 8.1-8.8 (referenced, never duplicated). It
will later ship as an in-app help menu and a standalone PDF built from these same files,
so it is a user-facing deliverable, not internal docs.

**Definition of done for any user-visible change** (a control, gesture, hotkey, mode, MCP
verb, export format, or error message): update the affected manual chapter, and the
reading-mode guide if the change is per-mode, in the same commit. `tests/manual.test.ts`
drift-checks the enumerable surface (view modes, tool palette, window presets, MCP verbs,
the manifest, the front-page version) against the source, so the gates fail when those go
stale; prose accuracy is on the author of the change. A `package.json` version bump is a
six-line checklist (CITATION.cff feeds the Zenodo deposit); lines 1 to 4 land in the bump
commit itself:

1. the version line in `docs/manual/00-front.md`, `mcp/package.json`, `mcp/manifest.json`;
2. `CITATION.cff` `version:`;
3. `CITATION.cff` `date-released:` (the day the release can first exist);
4. `CITATION.cff` `doi:` RESET to the concept DOI `10.5281/zenodo.21431452`. The previous
   release's version DOI becomes a wrong self-citation the moment the version changes.
   Missed on the v1.5.0 bump; the drift test now fails a bump that keeps it.
5. the GitHub release then mints the new version DOI on Zenodo, and a follow-up commit pins
   it in `doi:`;
6. update downstream surfaces per the Vault page's release ritual, in the same sitting. A
   release is not done when the release and the DOI exist; it is done when the surfaces
   that cite the version read it.

## Gates

```sh
npm run typecheck && npm run lint && npm test && npm run build
```

All four must pass before a change is done. A change to the agent surface also runs `npm run mcp:smoke` against a live demo tab. Never run `npm run build` while a dev server is up; they share `.next` and a concurrent build corrupts it (recovery: stop the server, `rm -rf .next`).

`tests/docs.test.ts` caps the size of this file, shrink-only: when `AGENTS.md` grows past the byte number in that test, trim the file, never raise the number.

The browser contract for every volume source is identical: Int16 LE HU voxels, x-fastest / y / z-ascending, plus a geometry JSON. Keep new sources on that contract and every reading mode works on them unchanged.
