// Manual drift test. The user manual (docs/manual/) is a product deliverable that must
// track the app; this test pins the ENUMERABLE surface to the source of truth in code, so
// the gates fail when a mode, tool, window preset, or MCP verb changes without the manual
// following. Prose accuracy stays on the author of the change (see AGENTS.md, "The user
// manual") — a test cannot read prose, but it can refuse to let the lists rot.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

const appSrc = read('components/cbct/CbctApp.tsx');
const mcpSrc = read('mcp/server.mjs');

/** Source text from a `const NAME ... = {` declaration up to its closing `};`. */
function declBlock(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start, `declaration "${marker}" not found — update this test's markers`).toBeGreaterThanOrEqual(0);
  const end = src.indexOf('\n};', start);
  expect(end, `unterminated declaration "${marker}"`).toBeGreaterThan(start);
  return src.slice(start, end);
}

const r3dSrc = read('components/cbct/render3d.ts');

const modes = [...(appSrc.match(/type ViewMode = ([^;]+);/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
// 3D style labels of the parametric "classic" group, trailing parentheticals stripped —
// these are the names the MPR guide's 3D section must keep current.
const styleLabels = [...r3dSrc.matchAll(/label: '([^']+)'/g)]
  .map((m) => m[1].replace(/\s*\([^)]*\)$/, ''))
  .filter((l) => !l.startsWith('CBCT'));
const presets = [...declBlock(appSrc, 'const WL_PRESETS').matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
const tools = [...declBlock(appSrc, 'const TOOL_LABEL').matchAll(/: '([^']+)'/g)].map((m) => m[1]);
const verbs = [...mcpSrc.matchAll(/registerTool\(\s*'(\w+)'/g)].map((m) => m[1]);

/** True when git history is unavailable or truncated (no repo, or a shallow clone). */
function historyUnavailable(): boolean {
  try {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return shallow === 'true';
  } catch {
    return true;
  }
}

describe('user manual tracks the app (docs/manual/)', () => {
  it('extracted the enumerable surface from the source', () => {
    expect(modes.length).toBeGreaterThanOrEqual(8);
    expect(presets.length).toBeGreaterThanOrEqual(4);
    expect(tools.length).toBeGreaterThanOrEqual(10);
    expect(verbs.length).toBeGreaterThanOrEqual(8);
  });

  it('every view mode has a reading guide, listed in the modes chapter', () => {
    const chapter = read('docs/manual/08-reading-modes.md');
    for (const mode of modes) {
      expect(existsSync(path.join(root, `docs/reading-modes/${mode}.md`)), `guide for mode "${mode}"`).toBe(true);
      expect(chapter, `08-reading-modes.md must link ${mode}.md`).toContain(`${mode}.md`);
    }
  });

  it('every reading guide opens with an At a glance card and embeds its still', () => {
    for (const mode of modes) {
      const guide = read(`docs/reading-modes/${mode}.md`);
      expect(guide, `${mode}.md must open with the At a glance card`).toContain('> **At a glance**');
      expect(guide, `${mode}.md must embed its still`).toContain(`../media/manual/mode-${mode}.webp`);
      expect(existsSync(path.join(root, `docs/media/manual/mode-${mode}.webp`)), `still for mode "${mode}"`).toBe(true);
    }
  });

  it('the interface chapter documents every header control and the status line, names the phantom, and carries the header still', () => {
    const chapter = read('docs/manual/03-interface.md');
    // the header's controls, in their order, as the reader sees them
    const header = appSrc.slice(appSrc.indexOf('<header'), appSrc.indexOf('</header>'));
    for (const label of ['Open', 'Keys', 'Help']) {
      expect(header, `the header control "${label}" was removed or renamed`).toMatch(new RegExp(`>\\s*${label}\\s*<`));
      expect(chapter, `03-interface.md must document the header control "${label}"`).toContain(`**${label}**`);
    }
    expect(read('components/cbct/ExportMenu.tsx')).toMatch(/>\s*Export\s*</);
    expect(chapter, '03-interface.md must document Export').toContain('**Export**');
    expect(read('components/cbct/SnapshotButton.tsx')).toContain("label = 'Snapshot'");
    expect(chapter, '03-interface.md must document Snapshot').toContain('**Snapshot**');
    expect(read('components/cbct/agent/AgentPanel.tsx')).toContain("'Agent on' : 'Agent'");
    expect(chapter, '03-interface.md must document the Agent button').toContain('**Agent**');
    for (const line of ['CBCT and radiograph viewer', 'See CBCTScope on a real scan', 'never uploaded']) {
      expect(appSrc, `"${line}" was removed or renamed`).toContain(line);
      expect(chapter, `03-interface.md must quote "${line}"`).toContain(line);
    }
    // the phantom has one name, the same in the catalog and the viewer
    expect(appSrc, 'the phantom label was removed or renamed').toContain("PHANTOM_NAME = 'Geometric test phantom'");
    expect(read('lib/shared/phantom.ts'), 'the catalog names the phantom as the viewer does').toContain(
      "PHANTOM_LABEL = 'Geometric test phantom'",
    );
    expect(chapter, '03-interface.md must name the phantom as the header does').toContain('**Geometric test phantom**');
    expect(chapter, '03-interface.md must embed the header still').toContain('../media/manual/header.webp');
    expect(existsSync(path.join(root, 'docs/media/manual/header.webp')), 'header still').toBe(true);
  });

  it('every window preset is documented in the display chapter', () => {
    const chapter = read('docs/manual/05-display.md');
    for (const preset of presets) expect(chapter, `05-display.md must document preset "${preset}"`).toContain(preset);
  });

  it('every tool is documented in the measuring chapter and the shortcut card', () => {
    for (const file of ['docs/manual/06-measure-annotate.md', 'docs/manual/12-shortcuts.md']) {
      const chapter = read(file);
      for (const tool of tools) expect(chapter, `${file} must document tool "${tool}"`).toContain(tool);
    }
  });

  it('every 3D style label is documented in the MPR guide', () => {
    const guide = read('docs/reading-modes/mpr.md');
    expect(styleLabels.length).toBeGreaterThanOrEqual(8);
    for (const label of styleLabels) expect(guide, `mpr.md must name 3D style "${label}"`).toContain(label);
  });

  it('every MCP verb is documented in the README, the agent chapter, and the MCP contract', () => {
    // the README's verb sentence rotted at v1.6.0 (still "eight verbs"); pin it too
    for (const file of ['README.md', 'docs/manual/09-agent.md', 'docs/mcp.md']) {
      const doc = read(file);
      for (const verb of verbs) expect(doc, `${file} must document verb "${verb}"`).toContain(`\`${verb}\``);
    }
  });

  it('every MCP resource and prompt is documented in the agent chapter and the MCP contract', () => {
    const resources = [...mcpSrc.matchAll(/registerResource\(\s*'(\w+)'/g)].map((m) => m[1]);
    const prompts = [...mcpSrc.matchAll(/registerPrompt\(\s*'([\w-]+)'/g)].map((m) => m[1]);
    expect(resources.length).toBeGreaterThanOrEqual(3);
    expect(prompts.length).toBeGreaterThanOrEqual(3);
    for (const file of ['docs/manual/09-agent.md', 'docs/mcp.md']) {
      const doc = read(file);
      for (const r of resources) expect(doc, `${file} must document resource cbctscope://${r}`).toContain(`cbctscope://${r}`);
      for (const p of prompts) expect(doc, `${file} must document prompt "${p}"`).toContain(`\`${p}\``);
    }
  });

  it('the web build menu entries, dialogues, and posture line are documented', () => {
    const dialogs = read('components/cbct/WebDialogs.tsx');
    const panel = read('components/cbct/OpenProgressPanel.tsx');
    const scan = read('lib/browser/scan.ts');
    const surface: [string, string, string][] = [
      [appSrc, 'Open DICOMDIR or DICOM folder', 'docs/manual/04-opening-scans.md'],
      [appSrc, 'Open a single DICOM file', 'docs/manual/04-opening-scans.md'],
      [appSrc, 'Drop a DICOM folder, a DICOMDIR or a single file here', 'docs/manual/04-opening-scans.md'],
      [read('desktop/native.mjs'), 'Open…', 'docs/manual/02-installation.md'],
      [read('desktop/native.mjs'), 'CBCTScope is already running, or another program uses its port', 'docs/manual/02-installation.md'],
      [read('desktop/native.mjs'), 'CBCTScope is already running, or another program', 'docs/manual/11-troubleshooting.md'],
      [appSrc, 'Download the desktop app', 'docs/manual/02-installation.md'],
      [panel, 'Reading headers', 'docs/manual/04-opening-scans.md'],
      [panel, 'Assembling the volume', 'docs/manual/04-opening-scans.md'],
      [panel, 'Preparing the display', 'docs/manual/04-opening-scans.md'],
      [scan, 'No DICOM volume found in', 'docs/manual/04-opening-scans.md'],
      [appSrc, 'Save marks to file', 'docs/manual/07-exporting.md'],
      [appSrc, 'Load marks from file', 'docs/manual/07-exporting.md'],
      [appSrc, 'Research use only.', 'docs/manual/02-installation.md'],
      [appSrc, 'Not a medical device.', 'docs/manual/02-installation.md'],
      [appSrc, 'Source code repository', 'docs/manual/03-interface.md'],
      [read('components/links.ts'), '/releases/latest', 'docs/manual/02-installation.md'],
      // the header's download menu (components/downloads.ts): its entries, its note, its fixed names
      ...['Mac with Apple silicon', 'Mac with Intel', 'All downloads and release notes', 'Which Mac? Apple menu, About This Mac.', 'CBCTScope-mac-arm64.dmg', 'CBCTScope-mac-x64.dmg', 'CBCTScope-windows-setup.exe'].map(
        (s) => [read('components/downloads.ts'), s, 'docs/manual/02-installation.md'] as [string, string, string],
      ),
      [dialogs, 'Research use only', 'docs/manual/04-opening-scans.md'],
      [dialogs, 'I understand', 'docs/manual/04-opening-scans.md'],
      [dialogs, 'Large volume', 'docs/manual/04-opening-scans.md'],
    ];
    for (const [src, label, file] of surface) {
      expect(src, `the web build label "${label}" was removed or renamed`).toContain(label);
      expect(read(file), `${file} must name "${label}"`).toContain(label);
    }
  });

  it('the manifest and the manual directory agree', () => {
    const manifest = JSON.parse(read('docs/manual/manifest.json')) as { chapters: { file: string; title: string }[] };
    for (const { file } of manifest.chapters) expect(existsSync(path.join(root, file)), `manifest entry ${file}`).toBe(true);
    const listed = new Set(manifest.chapters.map((c) => c.file));
    for (const name of readdirSync(path.join(root, 'docs/manual'))) {
      if (!name.endsWith('.md') || name === 'README.md') continue;
      expect(listed.has(`docs/manual/${name}`), `docs/manual/${name} is missing from manifest.json`).toBe(true);
    }
  });

  it('the front page and the citation file state the current version', () => {
    const version = (JSON.parse(read('package.json')) as { version: string }).version;
    expect(read('docs/manual/00-front.md'), `00-front.md must state version ${version}`).toContain(version);
    // CITATION.cff feeds the Zenodo deposit metadata on every GitHub release —
    // a stale version there ships a wrong citation.
    expect(read('CITATION.cff'), `CITATION.cff must state version ${version}`).toContain(`version: ${version}`);
    // the Agent Skill ships on its own to agent hosts, so its metadata names the release it teaches
    expect(read('skills/cbctscope-reading/SKILL.md'), `skills/cbctscope-reading/SKILL.md metadata.version must be "${version}"`).toMatch(
      new RegExp(`^metadata:\\n(?: {2}.*\\n)*? {2}version: "${version.replace(/\./g, '\\.')}"$`, 'm'),
    );
  });

  it('the citation file carries a release date at least as new as the version bump', () => {
    const cff = read('CITATION.cff');
    const version = (JSON.parse(read('package.json')) as { version: string }).version;
    const released = /^date-released:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(cff)?.[1];
    expect(released, 'CITATION.cff must carry a date-released of the form YYYY-MM-DD').toBeTruthy();

    // date-released is the only pinned release field that is not the version string, so the
    // other checks cannot see it go stale: a bump that forgets it ships the PREVIOUS release's
    // date to Zenodo with green gates. Anchor it to the commit that introduced the current
    // version, which is the day the release could first exist. A shallow clone would
    // attribute that line to HEAD and give a wrong answer, so it skips instead.
    if (historyUnavailable()) return;
    let bumped: string;
    try {
      bumped = execFileSync('git', ['log', '-1', '--format=%cs', '-S', `version: ${version}`, '--', 'CITATION.cff'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return; // no git history available (shallow export); the format check above still ran
    }
    if (!bumped) return; // version line not yet committed, e.g. mid-bump working tree
    // ISO dates sort lexicographically, so a string compare is the date compare.
    expect(released! >= bumped, `date-released ${released} predates the ${version} bump of ${bumped}`).toBe(true);
  });

  it('a version bump resets the citation DOI to the concept DOI', () => {
    // The ritual: the bump commit resets doi: to the concept DOI, because the previous
    // release's version DOI becomes a wrong self-citation the moment the version changes;
    // the new version DOI exists only after the release and is pinned in a follow-up
    // commit. Without this check a bump that keeps the previous version DOI passes every
    // other gate. Bumps up to 1.5.0 predate the check and stay green.
    const CONCEPT_DOI = '10.5281/zenodo.21431452';
    const version = (JSON.parse(read('package.json')) as { version: string }).version;
    const [major, minor] = version.split('.').map(Number);
    if (major < 1 || (major === 1 && minor <= 5)) return;
    if (historyUnavailable()) return; // a shallow clone would blame HEAD, see above

    let bumpCommit: string;
    try {
      bumpCommit = execFileSync('git', ['log', '-1', '--format=%H', '-S', `version: ${version}`, '--', 'CITATION.cff'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return; // no git history available (shallow export)
    }
    if (!bumpCommit) return; // version line not yet committed, e.g. mid-bump working tree
    const cffAtBump = execFileSync('git', ['show', `${bumpCommit}:CITATION.cff`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    expect(
      cffAtBump.includes(`doi: ${CONCEPT_DOI}`),
      `the ${version} bump commit must carry the concept DOI ${CONCEPT_DOI}; the version DOI is pinned only in the follow-up commit after the release mints it`,
    ).toBe(true);
  });

  it('no chapter uses an em dash', () => {
    const files = readdirSync(path.join(root, 'docs/manual')).filter((n) => n.endsWith('.md'));
    for (const name of files) expect(read(`docs/manual/${name}`), `${name} contains an em/en dash`).not.toMatch(/[—–]/);
  });
});
