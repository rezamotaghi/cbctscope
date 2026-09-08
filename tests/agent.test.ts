// Agent-surface drift test. The MCP server (mcp/server.mjs) hardcodes the enumerable
// surface it exposes (view modes, window presets, 3D styles) so hosts get real enums; this
// test pins those lists to the viewer source, pins the MCPB manifest (tool list, version)
// and the Agent Skill (name, verbs) to the server, so a verb or style added on one side
// cannot go stale on the other with green gates.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

const server = read('mcp/server.mjs');
const appSrc = read('components/cbct/CbctApp.tsx');
const r3dSrc = read('components/cbct/render3d.ts');

/** A `const NAME = [ 'a', 'b', ... ];` string-array literal in the server source. */
function serverList(name: string): string[] {
  const m = new RegExp(`const ${name} = \\[([^\\]]+)\\];`).exec(server);
  expect(m, `mcp/server.mjs must declare const ${name} = [...]`).toBeTruthy();
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const tools = [...server.matchAll(/registerTool\(\s*'(\w+)'/g)].map((m) => m[1]);
const prompts = [...server.matchAll(/registerPrompt\(\s*'([\w-]+)'/g)].map((m) => m[1]);

describe('MCP server tracks the viewer source', () => {
  it('view modes match the ViewMode union', () => {
    const modes = [...(appSrc.match(/type ViewMode = ([^;]+);/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(serverList('VIEW_MODES')).toEqual(modes);
  });

  it('window presets match WL_PRESETS', () => {
    const start = appSrc.indexOf('const WL_PRESETS');
    const block = appSrc.slice(start, appSrc.indexOf('\n};', start));
    const presets = [...block.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
    expect(serverList('WL_PRESETS')).toEqual(presets);
  });

  it('3D styles match the RENDER_STYLES keys', () => {
    const keys = [...r3dSrc.matchAll(/^ {2}'([^']+)': \{/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(serverList('STYLES_3D')).toEqual(keys);
  });

  it('every tool declares annotations and an output schema', () => {
    const blocks = server.split(/registerTool\(/).slice(1);
    expect(blocks.length).toBe(tools.length);
    for (const [i, b] of blocks.entries()) {
      const head = b.slice(0, b.indexOf('\n  async'));
      expect(head, `tool ${tools[i]} lacks annotations`).toMatch(/annotations:/);
      expect(head, `tool ${tools[i]} lacks outputSchema`).toMatch(/outputSchema:/);
    }
  });
});

describe('MCPB manifest and the Agent Skill track the server', () => {
  const manifest = JSON.parse(read('mcp/manifest.json')) as {
    name: string;
    version: string;
    server: { entry_point: string; mcp_config: { args: string[] } };
    tools: { name: string; description: string }[];
  };
  const version = (JSON.parse(read('package.json')) as { version: string }).version;

  it('carries the repo version, in both mcp/manifest.json and mcp/package.json', () => {
    expect(manifest.version, 'mcp/manifest.json version').toBe(version);
    expect((JSON.parse(read('mcp/package.json')) as { version: string }).version, 'mcp/package.json version').toBe(version);
  });

  it('lists exactly the registered tools', () => {
    expect(manifest.tools.map((t) => t.name).sort()).toEqual([...tools].sort());
    for (const t of manifest.tools) expect(t.description.length, `manifest tool ${t.name} description`).toBeGreaterThan(20);
  });

  it('points at the server file', () => {
    expect(manifest.server.entry_point).toBe('server.mjs');
    expect(manifest.server.mcp_config.args.join(' ')).toContain('server.mjs');
  });

  it('the skill is valid and names every verb and prompt', () => {
    const skill = read('skills/cbctscope-reading/SKILL.md');
    const fm = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(skill);
    expect(fm, 'SKILL.md must start with YAML frontmatter').toBeTruthy();
    const name = /^name:\s*(.+)$/m.exec(fm![1])?.[1].trim();
    expect(name, 'skill name must equal its directory name').toBe('cbctscope-reading');
    const description = /^description:\s*(.+)$/m.exec(fm![1])?.[1].trim() ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(skill, 'SKILL.md contains an em/en dash').not.toMatch(/[—–]/);
    expect(fm![2].split('\n').length, 'SKILL.md body should stay well under 500 lines').toBeLessThan(500);
    for (const t of tools) expect(fm![2], `SKILL.md must name verb ${t}`).toContain(`\`${t}\``);
    for (const p of prompts) expect(fm![2], `SKILL.md must name prompt ${p}`).toContain(`\`${p}\``);
  });
});
