#!/usr/bin/env node
// CBCTScope MCP server — native AI-agent control of the CBCT viewer.
//
// Scope (the MDR fence): every tool is clinical NAVIGATION or VISUALIZATION — open a scan,
// pick a volume, set the window, switch reading mode, move through slices, restore a saved
// view, take a snapshot. No tool returns findings, measurements-as-conclusions, or
// diagnoses, and there is no code execution: the agent moves the camera, the human reads.
// Resources expose the same state read-only; prompts are navigation choreographies
// distilled from the reading guides. See docs/mcp.md.
//
// Transport: stdio. The server is a thin proxy to a locally running viewer
// (default http://localhost:3810; override with CBCTSCOPE_URL).
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const VIEWER_URL = process.env.CBCTSCOPE_URL || 'http://localhost:3810';
// the sibling package.json travels with this file into the MCPB bundle; the drift test pins
// its version to the repo's
const { version: VERSION } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// ---- the enumerable surface, pinned to the viewer source by tests/agent.test.ts ----
const VIEW_MODES = ['mpr', 'grid', 'pano', 'tmj', 'reslice', 'ceph', 'region', 'stitch'];
const WL_PRESETS = ['Auto', 'Bone', 'Teeth', 'Soft'];
const STYLES_3D = [
  'style:shaded',
  'style:shiny',
  'style:surface',
  'style:soft-tissue',
  'style:mip',
  'style:xray',
  'style:xray-shaded',
  'style:bw-xray',
  'cbct:bone-teeth',
  'cbct:teeth',
  'cbct:translucent',
];
const PANES = ['axial', 'sagittal', 'coronal'];

async function viewerFetch(path, init) {
  let res;
  try {
    res = await fetch(`${VIEWER_URL}${path}`, init);
  } catch {
    throw new Error(
      `cannot reach the viewer at ${VIEWER_URL} — start it with \`npm run dev\` and open it in a browser`,
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

/** One line a reader or an agent can scan: what is on screen, in the pane's own words. */
function describe(state) {
  if (!state) return 'no viewer state';
  const parts = [];
  if (state.volume) parts.push(`volume ${state.volume.label ?? state.volume.id} (${state.volume.kind})`);
  else parts.push('no volume selected');
  parts.push(`mode ${state.viewMode}`);
  if (state.window) {
    parts.push(`window C ${state.window.center} / W ${state.window.width}${state.window.auto ? ' (Auto)' : ''}`);
  }
  if (state.invert) parts.push('inverted');
  if (state.slices) {
    for (const [pane, s] of Object.entries(state.slices)) {
      parts.push(`${pane.toUpperCase()} ${s.index + 1}/${s.count}${s.direction ? ` ${s.direction}` : ''}`);
    }
  }
  if (state.grid) {
    const g = state.grid;
    parts.push(
      `grid ${g.plane} centre ${g.index + 1}/${g.count}${g.direction ? ` ${g.direction}` : ''}, ${g.tiles} tiles every ${g.spacingMm} mm${g.oblique ? ' (rotated: index is along the oblique normal)' : ''}`,
    );
  }
  if (state.pano) {
    const p = state.pano;
    parts.push(`pano axial ${p.axial.index + 1}/${p.axial.count} ${p.axial.direction}`);
    parts.push(p.archLengthMm ? `arch ${p.archMm} / ${p.archLengthMm} mm` : 'no arch drawn');
  }
  if (state.style3d) parts.push(`3D ${state.style3d}`);
  if (Array.isArray(state.views)) parts.push(`${state.views.length} saved view${state.views.length === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/** Tool result: the text a host shows, plus the same data as structuredContent. */
function stateResult(state) {
  return {
    content: [{ type: 'text', text: `${describe(state)}\n${json(state)}` }],
    structuredContent: { state },
  };
}

// Tool annotations: every verb is closed-world (local viewer only) and non-destructive.
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const NAV = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ADD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const STATE_OUT = { state: z.object({}).passthrough() };
const CATALOG_OUT = { volumes: z.array(z.object({}).passthrough()) };
const OPEN_OUT = {
  canceled: z.boolean().optional(),
  opened: z.object({}).passthrough().optional(),
  volumes: z.array(z.object({}).passthrough()).optional(),
};
const VIEWS_OUT = { views: z.array(z.object({}).passthrough()) };

const server = new McpServer({ name: 'cbctscope', version: VERSION });

// ---------------------------------------------------------------- opening and selecting

server.registerTool(
  'open_scan',
  {
    title: 'Open a local CBCT scan',
    description:
      'Point the viewer at a local CBCT export: a folder, a DICOMDIR, a multiframe DICOM file, one slice of a series, or a single 2D radiograph file. The scan is read in place and never leaves the machine. Returns the volume catalog. Navigation only — this tool never interprets the images.',
    inputSchema: {
      path: z.string().describe('Absolute local path to the export folder, DICOMDIR, or DICOM file'),
    },
    outputSchema: OPEN_OUT,
    annotations: NAV,
  },
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
  {
    title: 'Let the human pick a scan',
    description:
      'Open the native file dialog on the machine running the viewer so the human chooses the export. The chosen path stays on that machine: the result carries the display label and the catalog, never the path. Cancel is a normal outcome ({ canceled: true }). The call waits while the dialog is open (up to five minutes).',
    inputSchema: {
      kind: z.enum(['folder', 'file']).optional().describe('folder (default): an export tree; file: one DICOMDIR, multiframe, slice, or radiograph'),
    },
    outputSchema: OPEN_OUT,
    annotations: NAV,
  },
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
  {
    title: 'List openable volumes',
    description:
      'List every volume the viewer can display: user-opened local volumes, session-stitched fusions, and the built-in synthetic demo phantom. Returns ids plus technical geometry (dimensions, voxel spacing, field of view).',
    inputSchema: {},
    outputSchema: CATALOG_OUT,
    annotations: READ,
  },
  async () => {
    const { volumes } = await viewerFetch('/api/cbct');
    return { content: [{ type: 'text', text: json(volumes) }], structuredContent: { volumes } };
  },
);

server.registerTool(
  'select_volume',
  {
    title: 'Select a volume',
    description: 'Display the volume with the given id (from list_volumes) in the viewer.',
    inputSchema: { id: z.string().describe('Volume id, e.g. local_…, fused_…, or demo_…') },
    outputSchema: STATE_OUT,
    annotations: NAV,
  },
  async ({ id }) => stateResult(await command('select_volume', { id })),
);

server.registerTool(
  'viewer_state',
  {
    title: 'Read the viewer state',
    description:
      'What is on screen right now: selected volume, reading mode, window, inversion, slice positions in the pane count with direction (MPR), grid window or pano arch position, 3D style, and the saved views of this volume. Read-only; the same data every mutating verb returns.',
    inputSchema: {},
    outputSchema: STATE_OUT,
    annotations: READ,
  },
  async () => stateResult(await command('get_state')),
);

// ---------------------------------------------------------------- display

server.registerTool(
  'set_view_mode',
  {
    title: 'Switch reading mode',
    description:
      'Switch the reading mode: mpr (orthogonal slices + 3D), grid (parallel slices), pano (curved panoramic + cross-sections), tmj (axis-corrected condyle sections), reslice (stack along a drawn path), ceph (virtual cephalogram), region (region growing + airway), stitch (register two volumes).',
    inputSchema: { mode: z.enum(VIEW_MODES) },
    outputSchema: STATE_OUT,
    annotations: NAV,
  },
  async ({ mode }) => stateResult(await command('set_view_mode', { mode })),
);

server.registerTool(
  'set_window_level',
  {
    title: 'Set window/level',
    description:
      'Set the HU display window: either a preset (Auto, Bone, Teeth, Soft) or an explicit center/width. Optionally toggle grayscale inversion. Visualization only — changes how voxels map to gray values.',
    inputSchema: {
      preset: z.enum(WL_PRESETS).optional(),
      center: z.number().optional().describe('window center in HU'),
      width: z.number().optional().describe('window width in HU (≥ 1)'),
      invert: z.boolean().optional(),
    },
    outputSchema: STATE_OUT,
    annotations: NAV,
  },
  async (args) => stateResult(await command('set_window_level', args)),
);

server.registerTool(
  'set_3d_style',
  {
    title: 'Set the 3D rendering style',
    description:
      'Pick the 3D pane\'s rendering style (MPR mode). style:* are the generic styles, cbct:* the CBCT presets; each loads its own default threshold. Visualization only.',
    inputSchema: { style: z.enum(STYLES_3D) },
    outputSchema: STATE_OUT,
    annotations: NAV,
  },
  async ({ style }) => stateResult(await command('set_3d_style', { style })),
);

// ---------------------------------------------------------------- moving

server.registerTool(
  'navigate_slice',
  {
    title: 'Navigate slices',
    description:
      'Move to a slice, in the pane\'s own count: 0-based, counting the way the on-screen label does (axial superior→inferior, coronal posterior→anterior, sagittal right→left), so the pane labelled "AXIAL 622/801 S→I" is index 621. Give an absolute index or a delta (positive = toward the label\'s "to" end). MPR: moves that pane. Grid: moves the window centre along the grid\'s plane (pane switches the plane; delta steps one grid spacing). Pano: pane axial moves the axial editor slice. Other modes have no slice to move.',
    inputSchema: {
      pane: z.enum(PANES).optional().describe('required in MPR and pano (axial); in grid it selects the plane, default the current one'),
      index: z.number().int().optional().describe('absolute slice index, 0-based, in the pane\'s own count (label number minus 1)'),
      delta: z.number().int().optional().describe('offset from the current slice; in grid, whole grid spacings'),
    },
    outputSchema: STATE_OUT,
    annotations: NAV,
  },
  async (args) => stateResult(await command('navigate_slice', args)),
);

server.registerTool(
  'navigate_arch',
  {
    title: 'Move along the arch (pano)',
    description:
      'Pano mode: center the cross-sections at a position along the drawn arch, in mm from the patient-right end (the on-screen arc ruler). Give an absolute position_mm or a delta_mm. Needs an arch; the human draws it (no verb draws anatomy).',
    inputSchema: {
      position_mm: z.number().optional(),
      delta_mm: z.number().optional(),
    },
    outputSchema: STATE_OUT,
    annotations: NAV,
  },
  async (args) => stateResult(await command('navigate_arch', args)),
);

server.registerTool(
  'reset_view',
  {
    title: 'Reset the view',
    description:
      'Reset camera orientation to orthogonal. With full=true also resets window/level, inversion, and gamma to the volume defaults.',
    inputSchema: { full: z.boolean().optional() },
    outputSchema: STATE_OUT,
    annotations: NAV,
  },
  async ({ full }) => stateResult(await command('reset_view', { full: !!full })),
);

// ---------------------------------------------------------------- saved views (MPR)

server.registerTool(
  'list_views',
  {
    title: 'List saved views',
    description:
      'The saved views of the selected volume (MPR mode): id, name, and who saved it (reader or agent). A saved view is a presentation — cameras, window, render settings — not a finding.',
    inputSchema: {},
    outputSchema: VIEWS_OUT,
    annotations: READ,
  },
  async () => {
    const { views } = await command('views', { op: 'list' });
    return { content: [{ type: 'text', text: json(views) }], structuredContent: { views } };
  },
);

server.registerTool(
  'goto_view',
  {
    title: 'Restore a saved view',
    description: 'Restore a saved view by id or exact name (MPR mode): cameras, window, and render settings return to that presentation.',
    inputSchema: { view: z.string().describe('view id (view-…) or its exact name') },
    outputSchema: STATE_OUT,
    annotations: NAV,
  },
  async ({ view }) => stateResult(await command('views', { op: 'goto', view })),
);

server.registerTool(
  'save_view',
  {
    title: 'Save the current view',
    description:
      'Bookmark the current presentation under a name (MPR mode). The view is written to the volume\'s annotation sidecar marked as agent-saved, and the viewer shows it with an agent badge so the reader never mistakes it for their own. Name a location or a task, never a finding.',
    inputSchema: { name: z.string().min(1).max(80) },
    outputSchema: STATE_OUT,
    annotations: ADD,
  },
  async ({ name }) => stateResult(await command('views', { op: 'save', name })),
);

// ---------------------------------------------------------------- looking

server.registerTool(
  'snapshot',
  {
    title: 'Snapshot the current view',
    description:
      'Capture the current viewing area (all visible panes) as a PNG image, with a one-line caption of the viewer state so the picture is never read out of context. Returns the pixels only; interpreting them is the human reader\'s job.',
    inputSchema: {},
    outputSchema: STATE_OUT,
    annotations: READ,
  },
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

const jsonResource = (uri, value) => ({ contents: [{ uri, mimeType: 'application/json', text: json(value) }] });

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

const FENCE =
  'You are operating the CBCTScope viewer for a human reader. Use only the cbctscope tools. Move the camera, window the image, take snapshots; do not describe, interpret, or diagnose what the images show. Hand the snapshots to the reader with their captions and stop.';

const promptText = (text) => ({ messages: [{ role: 'user', content: { type: 'text', text } }] });

server.registerPrompt(
  'mpr-survey',
  {
    title: 'MPR survey',
    description: 'Walk every MPR pane through its full extent at a bone window, snapshot at evenly spaced stops (from the MPR reading guide).',
    argsSchema: {
      stops: z.string().optional().describe('snapshots per pane (default 5)'),
      preset: z.string().optional().describe('window preset: Bone (default), Teeth, Soft, Auto'),
    },
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
    argsSchema: {
      step_mm: z.string().optional().describe('distance between cross-section stops in mm (default 10)'),
    },
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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`cbctscope MCP server ${VERSION} ready (viewer: ${VIEWER_URL})`);
