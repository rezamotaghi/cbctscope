# Security

CBCTScope reads medical images on the machine it runs on. This file states the trust
boundary it assumes, what falls inside it, and how to report a problem.

## Reporting a vulnerability

Report privately, not as a public issue: open a
[security advisory](https://github.com/rezamotaghi/cbctscope/security/advisories/new), or use
the contact page at [rezamotaghi.com/contact](https://rezamotaghi.com/contact).

Please include the version, your platform, and the smallest reproduction you have. Never
attach patient imaging: the built-in synthetic phantom (`npm run demo`) reproduces almost
everything, and if it genuinely cannot, describe the geometry rather than sending a scan.

This is research software maintained by one person. Reports are read, but no acknowledgement
or fix timeline is promised, and support is limited to the latest release.

## Not a medical device

CBCTScope visualizes and navigates volumes. It never produces findings, interpretations, or
diagnoses, in the UI or over MCP, and the agent verb surface is deliberately limited to
navigation and visualization with no code execution. Do not use it for clinical
decision-making. A change that would return an interpretation is out of scope by design, not
by omission.

## Threat model

This covers the agent surface (the MCP server in [mcp/server.mjs](mcp/server.mjs) and the
command bus under `/api/agent/*`) and the local server. Each threat lists what is in place,
checked against the code, what is left to the MCP host, and what is missing. Last reviewed
21/10/26.

### Tool poisoning and rug pulls

A poisoned tool hides instructions in its name, description, or schema. A rug pull changes a
tool after the user approved it.

- **In place.** The tool definitions are static strings in `mcp/server.mjs`,
  registered once before the transport connects. The server fetches nothing from the
  network and never changes its tool list at runtime, so the definitions a host shows are
  the ones that run until the user installs a new version. The verb set is closed:
  navigation and visualization only, no code execution, and the viewer rejects any verb it
  does not know. Every verb declares tool annotations: never destructive, never open-world,
  read-only where it only reads. `mcp/manifest.json` lists the same tools, and
  `tests/agent.test.ts` pins the manifest and the Agent Skill to the server.
- **Left to the host.** Showing the definitions before install, asking for consent before a
  call, and re-asking when a new version changes a tool. Annotations are hints a host may
  display. They enforce nothing.
- **Missing.** The `.mcpb` bundle is built and attached to the release by hand, and it is
  not signed. `mcp/` has no lockfile, so the bundle's dependencies resolve when it is packed.

### Prompt injection through tool results and images

Text or pixels returned by a tool can carry instructions a model may follow. Trail of Bits
reported on 21/08/25 that an image can hide a prompt that only appears once a pipeline
downscales it.

- **In place.** Tool results carry viewer state only: display labels built from folder and
  file names, the names of saved views, slice positions, window values, and technical
  geometry. No free-text DICOM tag reaches the agent; the only tag-derived text is the
  four-character study year. `snapshot` composes its PNG in the browser at the panes'
  native canvas resolution, with no resampling
  ([components/cbct/evidence.ts](components/cbct/evidence.ts)), so CBCTScope itself never
  downscales an image. The closed verb set bounds the worst case: a steered agent can open
  another DICOM on this disk, change the view, save a view marked as agent-saved, or take a
  snapshot. It cannot run code, delete anything, or reach the network through CBCTScope. The
  bundled prompts open with a fence: use only the CBCTScope tools, do not interpret, hand
  the snapshots to the reader and stop.
- **Left to the host.** Treating every result as data, never as instructions, and asking
  for consent before a call. The host's own image pipeline: it may still downscale a
  snapshot before the model sees it.
- **Missing.** Labels and view names pass through as written. There is no filter for
  instruction-like text, and pixels come from the scan, which can carry burned-in text.

### Confused deputy against the localhost server

A hostile web page uses the reader's own browser to drive a server on `127.0.0.1`: by DNS
rebinding, where its domain re-resolves to `127.0.0.1`, or by a cross-origin POST from
another tab.

- **In place.** [middleware.ts](middleware.ts) runs on every path (matcher `/:path*`). It
  rejects any request whose `Host` is not `127.0.0.1`, `localhost`, or `[::1]`, which
  defeats DNS rebinding. It rejects any request that carries a non-loopback or malformed
  `Origin`, which defeats cross-origin POSTs. The server binds `127.0.0.1` (`-H 127.0.0.1`
  in the `dev` and `start` scripts of `package.json`), so no other device can connect. The
  MCP server speaks stdio and opens no port. This Host and Origin check is the protection
  the official MCP SDKs switched on for their HTTP transports after these DNS-rebinding
  advisories: CVE-2025-66414 (TypeScript SDK, fixed in 1.24.0; the SDK this project uses, at
  1.30.0), CVE-2025-66416 (Python SDK, fixed in `mcp` 1.23.0), CVE-2026-34742 (Go SDK, fixed
  in 1.4.0), and CVE-2026-35568 (Java SDK, fixed in 1.0.0). CBCTScope uses none of those
  HTTP transports; its server speaks stdio, which the advisories list as unaffected.
- **Left to the host.** Nothing. This boundary lives in the viewer.
- **Missing, by design.** A non-browser process on the same machine sends no `Origin` and
  can POST to the bus. The MCP server is such a process, so this is how the bus works. A
  per-launch token would only stop local malware, which is already inside the trust
  boundary below, so it is not adopted.

### Runaway agent loops

An agent repeats a call without end, from a bug, a confused plan, or an injected
instruction.

- **In place.** Every command times out: the server clamps the wait to between 1 and 60
  seconds, 15 by default, so a stalled viewer never holds a call open. Every verb except
  `save_view` moves the view, opens a source, or reads state, and repeating one
  accumulates nothing on disk. `save_view` appends to the volume's annotation sidecar.
  That write is capped at 8 MB, and every agent-saved view carries an agent badge, so the
  reader can tell it from their own.
- **Left to the host.** Turn and tool-call budgets, consent prompts, and the user's stop
  control.
- **Missing.** There is no rate limit on `/api/agent/command`. It is queued.

## Trust boundary

CBCTScope is a single-user local tool. The assumption is that the browser, the server
process, and the scans are all on one machine controlled by one person.

- The server binds to `127.0.0.1` and rejects any request whose `Host` or `Origin` is not
  loopback. That covers DNS rebinding, where a hostile domain re-resolves to `127.0.0.1` so a
  victim's browser issues same-origin readable requests, and cross-site POSTs from a hostile
  page in another tab. Both the bind and the header checks are load-bearing. See
  [middleware.ts](middleware.ts).
- There is no authentication, and there is not meant to be. Anyone who can reach the loopback
  interface of the machine, or run code on it, is already inside the boundary.
- Do not expose the port. Do not put it behind a reverse proxy, a tunnel, or a container
  port mapping that publishes it. There is no hosted instance and there never will be one.

## Data handling

- Scans are read in place from the folder you pick. Nothing is copied or uploaded.
- No telemetry, no analytics, no outbound network calls.
- Absolute file paths never reach the browser or the agent transcript. The UI shows a display
  label derived from the folder and file names you opened, plus technical geometry.
- The only disk writes are an app-data folder (`~/.cbctscope`) holding annotation sidecars
  (labels, world-mm coordinates, HU statistics) and a pointer to the last source opened.
  Never pixels. Demo mode writes neither.
- Exports (PNG stack, NIfTI, STL) are computed in the browser and saved to this machine's
  Downloads folder.

Note that the annotation sidecars and the last-source pointer are stored unencrypted in your
home directory. They contain coordinates and measurements, not images, but treat them as you
would any other clinical note on the same disk.

## Out of scope

- Reports that require an attacker who already has code execution or a shell on the machine.
- Reports that depend on deliberately exposing the port to a network.
- Findings against a modified fork.
- Dependency advisories with no demonstrated path to impact in this application. Please open
  a normal issue for those instead.

## Verifying the repository

CI runs typecheck, lint, tests, and a production build on every push and pull request, plus a
[gitleaks](https://github.com/gitleaks/gitleaks) secret scan over the full history. CodeQL
scans the JavaScript and TypeScript on pushes to main, on pull requests, and once a week. Dependabot
proposes npm and GitHub Actions updates weekly. Every workflow action is pinned to a full
commit SHA, and the workflow token is read-only unless a job needs more. No DICOM
files or scan data have ever been committed. The repository's image content is the
procedurally generated phantom in `lib/server/phantom.ts` and the interface stills in
`docs/media/`; a still shows a real scan only with the patient's written consent, after
de-identification, and never as a soft-tissue surface (the standard is spelled out in
`AGENTS.md`, hard rule 3).
