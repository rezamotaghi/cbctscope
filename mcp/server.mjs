#!/usr/bin/env node
// CBCTScope MCP server: native AI-agent control of the CBCT viewer.
//
// Scope (the MDR fence): every tool is clinical NAVIGATION or VISUALIZATION: open a scan,
// pick a volume, set the window, switch reading mode, move through slices, restore a saved
// view, take a snapshot. No tool returns findings, measurements-as-conclusions, or
// diagnoses, and there is no code execution: the agent moves the camera, the human reads.
// Resources expose the same state read-only; prompts are navigation choreographies
// distilled from the reading guides. See docs/mcp.md.
//
// Transport: stdio, dual-era (MCP TypeScript SDK v2, `serveStdio`). The opening exchange
// picks the protocol era of the connection: a host that opens with `initialize` gets
// revision 2025-11-25, a host that opens with the per-request `_meta` envelope gets the
// stateless revision 2026-07-28. One factory builds the server for either era, so the
// surface is the same in both. The server is a thin proxy to a locally running viewer
// (default http://localhost:3810; override with CBCTSCOPE_URL).
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
// the fifteen verbs (names, descriptions, Zod schemas, annotations), the fence and the state
// caption live in one module the in-page agent of the web build shares (lib/shared/verbs.mjs)
import { FENCE, describe, toolConfig } from '../lib/shared/verbs.mjs';

const VIEWER_URL = process.env.CBCTSCOPE_URL || 'http://localhost:3810';
// the sibling package.json travels with this file into the MCPB bundle; the drift test pins
// its version to the repo's
const { version: VERSION } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

async function viewerFetch(path, init) {
  let res;
  try {
    res = await fetch(`${VIEWER_URL}${path}`, init);
  } catch {
    throw new Error(
      `cannot reach the viewer at ${VIEWER_URL}: start it with \`npm run dev\` and open it in a browser`,
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `viewer returned ${res.status}`);
  return body;
}

async function command(verb, args = {}, timeoutMs) {
  const out = await viewerFetch('/api/agent/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verb, args, timeoutMs }),
  });
  if (!out.ok) throw new Error(out.error || 'command failed');
  return out.result;
}

const json = (value) => JSON.stringify(value, null, 2);

/** Tool result: the text a host shows, plus the same data as structuredContent. */
function stateResult(state) {
  return {
    content: [{ type: 'text', text: `${describe(state)}\n${json(state)}` }],
    structuredContent: { state },
  };
}

const jsonResource = (uri, value) => ({ contents: [{ uri, mimeType: 'application/json', text: json(value) }] });

const promptText = (text) => ({ messages: [{ role: 'user', content: { type: 'text', text } }] });

/** One server instance per connection (and per discarded era probe), built the same way for both eras. */
function buildServer() {
  const server = new McpServer({ name: 'cbctscope', version: VERSION });

  // ---------------------------------------------------------------- opening and selecting

  server.registerTool(
    'open_scan',
    toolConfig('open_scan'),
    async ({ path }) => {
      const opened = await viewerFetch('/api/cbct/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const { volumes } = await viewerFetch('/api/cbct');
      return { content: [{ type: 'text', text: json({ opened, volumes }) }], structuredContent: { opened, volumes } };
    },
  );

  server.registerTool(
    'pick_scan',
    toolConfig('pick_scan'),
    async ({ kind }) => {
      const picked = await viewerFetch('/api/cbct/source/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: kind ?? 'folder' }),
      });
      if (picked.canceled) {
        return { content: [{ type: 'text', text: 'the human canceled the dialog' }], structuredContent: { canceled: true } };
      }
      const { volumes } = await viewerFetch('/api/cbct');
      return { content: [{ type: 'text', text: json({ opened: picked, volumes }) }], structuredContent: { opened: picked, volumes } };
    },
  );

  server.registerTool(
    'list_volumes',
    toolConfig('list_volumes'),
    async () => {
      const { volumes } = await viewerFetch('/api/cbct');
      return { content: [{ type: 'text', text: json(volumes) }], structuredContent: { volumes } };
    },
  );

  server.registerTool(
    'select_volume',
    toolConfig('select_volume'),
    async ({ id }) => stateResult(await command('select_volume', { id })),
  );

  server.registerTool(
    'viewer_state',
    toolConfig('viewer_state'),
    async () => stateResult(await command('get_state')),
  );

  // ---------------------------------------------------------------- display

  server.registerTool(
    'set_view_mode',
    toolConfig('set_view_mode'),
    async ({ mode }) => stateResult(await command('set_view_mode', { mode })),
  );

  server.registerTool(
    'set_window_level',
    toolConfig('set_window_level'),
    async (args) => stateResult(await command('set_window_level', args)),
  );

  server.registerTool(
    'set_3d_style',
    toolConfig('set_3d_style'),
    async ({ style }) => stateResult(await command('set_3d_style', { style })),
  );

  // ---------------------------------------------------------------- moving

  server.registerTool(
    'navigate_slice',
    toolConfig('navigate_slice'),
    async (args) => stateResult(await command('navigate_slice', args)),
  );

  server.registerTool(
    'navigate_arch',
    toolConfig('navigate_arch'),
    async (args) => stateResult(await command('navigate_arch', args)),
  );

  server.registerTool(
    'reset_view',
    toolConfig('reset_view'),
    async ({ full }) => stateResult(await command('reset_view', { full: !!full })),
  );

  // ---------------------------------------------------------------- saved views (MPR)

  server.registerTool(
    'list_views',
    toolConfig('list_views'),
    async () => {
      const { views } = await command('views', { op: 'list' });
      return { content: [{ type: 'text', text: json(views) }], structuredContent: { views } };
    },
  );

  server.registerTool(
    'goto_view',
    toolConfig('goto_view'),
    async ({ view }) => stateResult(await command('views', { op: 'goto', view })),
  );

  server.registerTool(
    'save_view',
    toolConfig('save_view'),
    async ({ name }) => stateResult(await command('views', { op: 'save', name })),
  );

  // ---------------------------------------------------------------- looking

  server.registerTool(
    'snapshot',
    toolConfig('snapshot'),
    async () => {
      const result = await command('snapshot', {}, 30_000);
      const state = result.state ?? null;
      return {
        content: [
          { type: 'image', data: result.pngBase64, mimeType: 'image/png' },
          { type: 'text', text: describe(state) },
        ],
        structuredContent: { state },
      };
    },
  );

  // ---------------------------------------------------------------- resources (read-only)

  server.registerResource(
    'volumes',
    'cbctscope://volumes',
    { title: 'Volume catalog', description: 'Every volume the viewer can display, with technical geometry.', mimeType: 'application/json' },
    async (uri) => jsonResource(uri.href, (await viewerFetch('/api/cbct')).volumes),
  );

  server.registerResource(
    'state',
    'cbctscope://state',
    { title: 'Viewer state', description: 'What is on screen right now (same data as viewer_state).', mimeType: 'application/json' },
    async (uri) => jsonResource(uri.href, await command('get_state')),
  );

  server.registerResource(
    'views',
    'cbctscope://views',
    { title: 'Saved views', description: 'Saved views of the selected volume (MPR mode).', mimeType: 'application/json' },
    async (uri) => jsonResource(uri.href, (await command('views', { op: 'list' })).views),
  );

  server.registerResource(
    'volume',
    new ResourceTemplate('cbctscope://volume/{id}', {
      list: async () => {
        let volumes = [];
        try {
          volumes = (await viewerFetch('/api/cbct')).volumes ?? [];
        } catch {
          /* viewer down: nothing to list */
        }
        return {
          resources: volumes.map((v) => ({
            uri: `cbctscope://volume/${v.anon}`,
            name: v.label ?? v.anon,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    { title: 'Volume geometry', description: 'Geometry and default window of one volume, by id.', mimeType: 'application/json' },
    async (uri, { id }) => jsonResource(uri.href, await viewerFetch(`/api/cbct/${encodeURIComponent(String(id))}`)),
  );

  // ---------------------------------------------------------------- prompts (choreographies)
  // Distilled from docs/reading-modes: mode, window, slice cadence, snapshot points. Every
  // prompt ends where the guides end: the pictures go to the human reader.

  server.registerPrompt(
    'mpr-survey',
    {
      title: 'MPR survey',
      description: 'Walk every MPR pane through its full extent at a bone window, snapshot at evenly spaced stops (from the MPR reading guide).',
      argsSchema: z.object({
        stops: z.string().optional().describe('snapshots per pane (default 5)'),
        preset: z.string().optional().describe('window preset: Bone (default), Teeth, Soft, Auto'),
      }),
    },
    ({ stops, preset }) =>
      promptText(
        `${FENCE}\n\nMPR survey. Steps:\n1. viewer_state; if no volume is selected, list_volumes and select_volume.\n2. set_view_mode mpr, reset_view full=true, set_window_level preset ${preset || 'Bone'}.\n3. For each pane (axial, sagittal, coronal): read its slice count from viewer_state, then navigate_slice to ${stops || 5} evenly spaced indices from the first to the last slice, and snapshot at each stop.\n4. Finish with reset_view and one final snapshot of the orthogonal layout.\nReport the list of snapshots with their captions only.`,
      ),
  );

  server.registerPrompt(
    'pano-survey',
    {
      title: 'Pano survey',
      description: 'Survey the panoramic reconstruction end to end at a teeth window, cross-sections stepped along the arch (from the Pano reading guide).',
      argsSchema: z.object({
        step_mm: z.string().optional().describe('distance between cross-section stops in mm (default 10)'),
      }),
    },
    ({ step_mm }) =>
      promptText(
        `${FENCE}\n\nPano survey. Steps:\n1. set_view_mode pano, set_window_level preset Teeth, then viewer_state.\n2. If the state reports no arch drawn, stop and ask the reader to draw the arch through the roots and alveolar process (no verb draws anatomy); resume when viewer_state reports an arch length.\n3. navigate_arch position_mm 0, then step with delta_mm ${step_mm || 10} to the arch length, snapshot at every stop.\nReport the snapshots with their captions only.`,
      ),
  );

  server.registerPrompt(
    'tmj-read',
    {
      title: 'TMJ read setup',
      description: 'Set up the TMJ mode at a bone window and record both condyle rows (from the TMJ reading guide).',
    },
    () =>
      promptText(
        `${FENCE}\n\nTMJ read. Steps:\n1. set_view_mode tmj, set_window_level preset Bone.\n2. The condylar axis lines are drawn by hand: ask the reader to place one line per side, lateral pole to medial pole, then confirm.\n3. snapshot once both condyle rows are on screen.\nReport the snapshot with its caption only.`,
      ),
  );

  server.registerPrompt(
    'replay-views',
    {
      title: 'Replay saved views',
      description: 'Restore every saved view of the selected volume in order and snapshot each, so a reader can verify a set of bookmarked presentations.',
    },
    () =>
      promptText(
        `${FENCE}\n\nReplay saved views. Steps:\n1. set_view_mode mpr, then list_views.\n2. For each view in order: goto_view by id, wait for the state to report it, snapshot.\n3. reset_view at the end.\nReport, per view, its name, who saved it, and the snapshot caption. Nothing else.`,
      ),
  );

  return server;
}

// Dual-era stdio: `initialize` openings are served on revision 2025-11-25 (legacy is not
// rejected), `_meta` openings on 2026-07-28. stdout carries only the protocol; the one log
// line goes to stderr.
serveStdio(() => buildServer());
console.error(`cbctscope MCP server ${VERSION} ready (viewer: ${VIEWER_URL})`);
