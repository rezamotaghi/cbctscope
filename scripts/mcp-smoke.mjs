#!/usr/bin/env node
// Live smoke test of the MCP surface against a RUNNING viewer with a browser tab open
// (npm run demo, then open http://localhost:3810). Spawns mcp/server.mjs the way a host
// does, walks every tool, resource, and prompt on the demo phantom, and fails on the first
// wrong answer. The server is dual-era, so the walk runs once per protocol era: a client
// that opens with `initialize` (revision 2025-11-25, Claude Desktop and most hosts today)
// and a client pinned to the stateless revision 2026-07-28 (`server/discover`, per-request
// `_meta`). A third connection in `auto` mode, the probe-then-fall-back that dual-era hosts
// run, must land on 2026-07-28. Not part of `npm test` (needs a live browser); run it
// before a release:
//   npm run mcp:smoke                      (both eras; pick_scan skipped: it opens a modal dialog)
//   npm run mcp:smoke -- --era=2025-11-25  (one era only; or --era=2026-07-28)
//   npm run mcp:smoke -- --pick            (also opens the native dialog; cancel it by hand)
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.mjs');
const withPick = process.argv.includes('--pick');
// client-side negotiation per era: 'legacy' sends `initialize`; a pin speaks only that revision
const ERAS = {
  '2025-11-25': { mode: 'legacy', era: 'legacy' },
  '2026-07-28': { mode: { pin: '2026-07-28' }, era: 'modern' },
};
const eraArg = process.argv.find((a) => a.startsWith('--era='))?.slice('--era='.length);
if (eraArg && !ERAS[eraArg]) {
  console.error(`unknown --era=${eraArg}; use one of ${Object.keys(ERAS).join(', ')}`);
  process.exit(2);
}

const connect = async (mode) => {
  const client = new Client({ name: 'cbctscope-smoke', version: '0' }, { versionNegotiation: { mode } });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], stderr: 'pipe' }));
  return client;
};

let client;
let failed = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failed++;
};
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${r.content?.map((c) => c.text).join(' ')}`);
  return r;
};
const state = (r) => r.structuredContent?.state;

/** One full walk of the surface over the connected client. */
async function walk(first) {
  // ---- surface
  const tools = (await client.listTools()).tools;
  check('tools listed', tools.length >= 15, `${tools.length} tools`);
  check('every tool has annotations + outputSchema', tools.every((t) => t.annotations && t.outputSchema));
  const resources = (await client.listResources()).resources;
  check('resources listed', resources.length >= 3, resources.map((r) => r.uri).join(' '));
  const templates = (await client.listResourceTemplates()).resourceTemplates;
  check('resource template listed', templates.some((t) => t.uriTemplate === 'cbctscope://volume/{id}'));
  const prompts = (await client.listPrompts()).prompts;
  check('prompts listed', prompts.length >= 4, prompts.map((p) => p.name).join(' '));

  // ---- catalog + selection
  const vols = (await call('list_volumes')).structuredContent.volumes;
  const demo = vols.find((v) => String(v.anon).startsWith('demo'));
  check('demo phantom in catalog', !!demo, demo?.anon);
  check('select_volume returns state', state(await call('select_volume', { id: demo.anon }))?.volume?.id === demo.anon);

  // ---- MPR
  let st = state(await call('set_view_mode', { mode: 'mpr' }));
  check('mpr mode', st.viewMode === 'mpr');
  st = state(await call('set_window_level', { preset: 'Bone' }));
  check('Bone preset applied', st.window && !st.window.auto);
  await new Promise((r) => setTimeout(r, 1500)); // panes mount + first render
  st = state(await call('navigate_slice', { pane: 'axial', index: 100 }));
  check('axial index 100 in the pane count', st.slices?.axial?.index === 100, JSON.stringify(st.slices?.axial));
  st = state(await call('navigate_slice', { pane: 'axial', delta: -10 }));
  check('axial delta -10', st.slices?.axial?.index === 90, JSON.stringify(st.slices?.axial));
  st = state(await call('set_3d_style', { style: 'cbct:teeth' }));
  check('3D style set', st.style3d === 'cbct:teeth', st.style3d);
  st = state(await call('viewer_state'));
  check('viewer_state carries slices for all three panes', ['axial', 'sagittal', 'coronal'].every((p) => st.slices?.[p]));

  // ---- saved views, agent-marked
  const name = `smoke ${Date.now().toString(36)}`;
  st = state(await call('save_view', { name }));
  const views = (await call('list_views')).structuredContent.views;
  const mine = views.find((v) => v.name === name);
  check('save_view listed, by agent', mine?.by === 'agent', JSON.stringify(mine));
  await call('navigate_slice', { pane: 'axial', index: 300 });
  st = state(await call('goto_view', { view: mine.id }));
  check('goto_view by id restores the axial slice', st.slices?.axial?.index === 90, JSON.stringify(st.slices?.axial));
  await call('navigate_slice', { pane: 'axial', index: 300 });
  st = state(await call('goto_view', { view: name }));
  check('goto_view by name', st.slices?.axial?.index === 90);
  let threw = null;
  try {
    await call('goto_view', { view: 'no-such-view' });
  } catch (e) {
    threw = e.message;
  }
  check('goto_view unknown name errors clearly', /no saved view/.test(threw ?? ''), threw);

  // ---- snapshot: image + caption + state
  const snap = await call('snapshot');
  const img = snap.content.find((c) => c.type === 'image');
  const cap = snap.content.find((c) => c.type === 'text');
  check('snapshot returns a PNG', img && img.mimeType === 'image/png' && img.data.length > 5000, `${img?.data?.length} b64 chars`);
  check('snapshot caption names the mode', /mode mpr/.test(cap?.text ?? ''), cap?.text);
  check('snapshot structuredContent carries state', !!state(snap)?.viewMode);

  // ---- grid
  st = state(await call('set_view_mode', { mode: 'grid' }));
  await new Promise((r) => setTimeout(r, 1500));
  st = state(await call('viewer_state'));
  check('grid state reported', st.grid?.plane === 'axial' && st.grid.count > 0, JSON.stringify(st.grid));
  const g0 = st.grid.index;
  st = state(await call('navigate_slice', { delta: 2 }));
  check('grid delta moves the centre', st.grid.index !== g0, `${g0} -> ${st.grid.index}`);
  st = state(await call('navigate_slice', { pane: 'coronal', index: 40 }));
  check('grid pane switch + index', st.grid.plane === 'coronal' && st.grid.index === 40, JSON.stringify(st.grid));

  // ---- pano
  st = state(await call('set_view_mode', { mode: 'pano' }));
  await new Promise((r) => setTimeout(r, 1500));
  st = state(await call('navigate_slice', { pane: 'axial', index: 50 }));
  check('pano axial index 50', st.pano?.axial?.index === 50, JSON.stringify(st.pano));
  threw = null;
  try {
    await call('navigate_slice', { pane: 'sagittal', index: 1 });
  } catch (e) {
    threw = e.message;
  }
  check('pano rejects a non-axial pane clearly', /navigate_arch/.test(threw ?? ''), threw);
  const arch = await call('navigate_arch', { delta_mm: 5 }).catch((e) => e);
  check(
    'navigate_arch answers (moved, or "no arch" when none is drawn)',
    arch instanceof Error ? /no arch/.test(arch.message) : typeof state(arch)?.pano?.archMm === 'number',
    arch instanceof Error ? arch.message : JSON.stringify(state(arch)?.pano),
  );

  // ---- a mode with nothing to move
  await call('set_view_mode', { mode: 'ceph' });
  threw = null;
  try {
    await call('navigate_slice', { pane: 'axial', index: 1 });
  } catch (e) {
    threw = e.message;
  }
  check('ceph: navigate_slice fails fast with a clear error', /no slice to move/.test(threw ?? ''), threw);

  // ---- resources + prompts
  const rs = await client.readResource({ uri: 'cbctscope://state' });
  check('resource state reads', JSON.parse(rs.contents[0].text).viewMode === 'ceph');
  const rv = await client.readResource({ uri: `cbctscope://volume/${demo.anon}` });
  check('resource volume/{id} reads geometry', Array.isArray(JSON.parse(rv.contents[0].text).dims));
  const pr = await client.getPrompt({ name: 'mpr-survey', arguments: { stops: '3' } });
  check('prompt mpr-survey renders with its argument', /3 evenly spaced/.test(pr.messages[0].content.text));
  const pv = await client.getPrompt({ name: 'replay-views' });
  check('prompt replay-views renders', /goto_view/.test(pv.messages[0].content.text));

  // ---- reset + optional pick
  st = state(await call('reset_view', { full: true }));
  check('reset_view full returns Auto window', st.window?.auto === true);
  if (withPick && first) {
    const picked = await call('pick_scan', { kind: 'folder' });
    check('pick_scan (dialog): answered without a path', !JSON.stringify(picked.structuredContent).includes('"path"'), JSON.stringify(picked.structuredContent));
  }
}

for (const [i, era] of (eraArg ? [eraArg] : Object.keys(ERAS)).entries()) {
  const spec = ERAS[era];
  console.log(`\n== protocol revision ${era}`);
  try {
    client = await connect(spec.mode);
    const got = `${client.getProtocolEra()} ${client.getNegotiatedProtocolVersion()}`;
    check(`negotiated ${era}`, got === `${spec.era} ${era}`, got);
    await walk(i === 0);
  } catch (e) {
    check(`smoke run completed (${era})`, false, e instanceof Error ? e.message : String(e));
  } finally {
    await client?.close();
    client = undefined;
  }
}

if (!eraArg) {
  // what a dual-era host does: probe with server/discover, fall back to initialize if refused
  console.log('\n== auto negotiation (probe, then fall back)');
  try {
    client = await connect('auto');
    const got = `${client.getProtocolEra()} ${client.getNegotiatedProtocolVersion()}`;
    check('auto selects 2026-07-28', got === 'modern 2026-07-28', got);
    const tools = (await client.listTools()).tools;
    check('auto: tools listed', tools.length >= 15, `${tools.length} tools`);
  } catch (e) {
    check('auto negotiation completed', false, e instanceof Error ? e.message : String(e));
  } finally {
    await client?.close();
    client = undefined;
  }
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
