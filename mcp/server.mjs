#!/usr/bin/env node
// CBCTScope MCP server — native AI-agent control of the CBCT viewer.
//
// Scope (the MDR fence): every tool is clinical NAVIGATION or VISUALIZATION — open a scan,
// pick a volume, set the window, switch reading mode, move through slices, take a snapshot.
// No tool returns findings, measurements-as-conclusions, or diagnoses, and there is no code
// execution: the agent moves the camera, the human reads. See docs/mcp.md.
//
// Transport: stdio. The server is a thin proxy to a locally running viewer
// (default http://localhost:3810; override with CBCTSCOPE_URL).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const VIEWER_URL = process.env.CBCTSCOPE_URL || 'http://localhost:3810';

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

const text = (value) => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

const server = new McpServer({ name: 'cbctscope', version: '1.0.0' });

server.registerTool(
  'open_scan',
  {
    title: 'Open a local CBCT scan',
    description:
      'Point the viewer at a local CBCT export: a folder, a DICOMDIR, a multiframe DICOM file, or one slice of a series. The scan is read in place and never leaves the machine. Returns the volume catalog. Navigation only — this tool never interprets the images.',
    inputSchema: {
      path: z.string().describe('Absolute local path to the export folder, DICOMDIR, or DICOM file'),
    },
  },
  async ({ path }) => {
    const opened = await viewerFetch('/api/cbct/source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const list = await viewerFetch('/api/cbct');
    return text({ opened, volumes: list.volumes });
  },
);

server.registerTool(
  'list_volumes',
  {
    title: 'List openable volumes',
    description:
      'List every volume the viewer can display: user-opened local volumes, session-stitched fusions, and the built-in synthetic demo phantom. Returns ids plus technical geometry (dimensions, voxel spacing, field of view).',
    inputSchema: {},
  },
  async () => text((await viewerFetch('/api/cbct')).volumes),
);

server.registerTool(
  'select_volume',
  {
    title: 'Select a volume',
    description: 'Display the volume with the given id (from list_volumes) in the viewer.',
    inputSchema: { id: z.string().describe('Volume id, e.g. local_…, fused_…, or demo_…') },
  },
  async ({ id }) => text(await command('select_volume', { id })),
);

server.registerTool(
  'set_view_mode',
  {
    title: 'Switch reading mode',
    description:
      'Switch the reading mode: mpr (orthogonal slices + 3D), grid (parallel slices), pano (curved panoramic + cross-sections), tmj (axis-corrected condyle sections), reslice (stack along a drawn path), ceph (virtual cephalogram), region (region growing + airway), stitch (register two volumes).',
    inputSchema: {
      mode: z.enum(['mpr', 'grid', 'pano', 'tmj', 'reslice', 'ceph', 'region', 'stitch']),
    },
  },
  async ({ mode }) => text(await command('set_view_mode', { mode })),
);

server.registerTool(
  'set_window_level',
  {
    title: 'Set window/level',
    description:
      'Set the HU display window: either a preset (Auto, Bone, Teeth, Soft) or an explicit center/width. Optionally toggle grayscale inversion. Visualization only — changes how voxels map to gray values.',
    inputSchema: {
      preset: z.enum(['Auto', 'Bone', 'Teeth', 'Soft']).optional(),
      center: z.number().optional().describe('window center in HU'),
      width: z.number().optional().describe('window width in HU (≥ 1)'),
      invert: z.boolean().optional(),
    },
  },
  async (args) => text(await command('set_window_level', args)),
);

server.registerTool(
  'navigate_slice',
  {
    title: 'Navigate slices',
    description:
      'Move an MPR pane to a slice: pane is axial, sagittal, or coronal; give an absolute index or a delta from the current slice. Available in mpr mode.',
    inputSchema: {
      pane: z.enum(['axial', 'sagittal', 'coronal']),
      index: z.number().int().optional().describe('absolute slice index (0-based)'),
      delta: z.number().int().optional().describe('offset from the current slice'),
    },
  },
  async (args) => text(await command('navigate_slice', args)),
);

server.registerTool(
  'snapshot',
  {
    title: 'Snapshot the current view',
    description:
      'Capture the current viewing area (all visible panes) as a PNG image. Returns the pixels only; interpreting them is the human reader’s job.',
    inputSchema: {},
  },
  async () => {
    const result = await command('snapshot', {}, 30_000);
    return {
      content: [
        { type: 'image', data: result.pngBase64, mimeType: 'image/png' },
      ],
    };
  },
);

server.registerTool(
  'reset_view',
  {
    title: 'Reset the view',
    description:
      'Reset camera orientation to orthogonal. With full=true also resets window/level, inversion, and gamma to the volume defaults.',
    inputSchema: { full: z.boolean().optional() },
  },
  async ({ full }) => text(await command('reset_view', { full: !!full })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`cbctscope MCP server ready (viewer: ${VIEWER_URL})`);
