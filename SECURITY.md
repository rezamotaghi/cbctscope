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
[gitleaks](https://github.com/gitleaks/gitleaks) secret scan over the full history. No DICOM
files or patient imaging have ever been committed. The only image content in the repository
is the procedurally generated phantom in `lib/server/phantom.ts`.
