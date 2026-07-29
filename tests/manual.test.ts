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

  it('every MCP verb is documented in the agent chapter', () => {
    const chapter = read('docs/manual/09-agent.md');
    for (const verb of verbs) expect(chapter, `09-agent.md must document verb "${verb}"`).toContain(verb);
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
  });

  it('the citation file carries a release date at least as new as the version bump', () => {
    const cff = read('CITATION.cff');
    const version = (JSON.parse(read('package.json')) as { version: string }).version;
    const released = /^date-released:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(cff)?.[1];
    expect(released, 'CITATION.cff must carry a date-released of the form YYYY-MM-DD').toBeTruthy();

    // date-released is the only pinned release field that is not the version string, so the
    // other checks cannot see it go stale: a bump that forgets it ships the PREVIOUS release's
    // date to Zenodo with green gates. Anchor it to the commit that introduced the current
    // version, which is the day the release could first exist.
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

  it('no chapter uses an em dash', () => {
    const files = readdirSync(path.join(root, 'docs/manual')).filter((n) => n.endsWith('.md'));
    for (const name of files) expect(read(`docs/manual/${name}`), `${name} contains an em/en dash`).not.toMatch(/[—–]/);
  });
});
