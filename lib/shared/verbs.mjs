// The fifteen verbs of the agent surface, one module for both callers: the MCP server
// (mcp/server.mjs, Node) registers them as MCP tools, and the in-page agent of the web build
// (components/cbct/agent/) offers them to the clinician's own model as its tools. Same names,
// same descriptions, same Zod schemas, so the two surfaces cannot drift apart
// (tests/agentTools.test.ts lists the server's tools over stdio and compares them with the
// page's, name for name and schema for schema).
//
// The MDR fence: every verb is clinical NAVIGATION or VISUALIZATION. No verb returns
// findings, measurements-as-conclusions or diagnoses, and none executes code.
//
// Plain ESM with no Node API: it rides in the browser bundle as well as in the Node server
// and the MCPB bundle (scripts/mcpb.mjs stages it next to server.mjs).
import { z } from 'zod';

// ---- the enumerable surface, pinned to the viewer source by tests/agent.test.ts ----
export const VIEW_MODES = ['mpr', 'grid', 'pano', 'tmj', 'reslice', 'ceph', 'region', 'stitch'];
export const WL_PRESETS = ['Auto', 'Bone', 'Teeth', 'Soft'];
export const STYLES_3D = [
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
  'CT-Air',
];
export const PANES = ['axial', 'sagittal', 'coronal'];

// Tool annotations: every verb is closed-world (local viewer only) and non-destructive.
export const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const NAV = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const ADD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

// Output schemas: Zod 4 objects; the viewer's records pass through whole (looseObject).
const STATE_OUT = z.object({ state: z.looseObject({}) });
const CATALOG_OUT = z.object({ volumes: z.array(z.looseObject({})) });
const OPEN_OUT = z.object({
  canceled: z.boolean().optional(),
  opened: z.looseObject({}).optional(),
  volumes: z.array(z.looseObject({})).optional(),
});
const VIEWS_OUT = z.object({ views: z.array(z.looseObject({})) });

/**
 * The verbs in registration order. `route` is how a caller inside the page reaches the
 * viewer: a bridge verb with fixed extra arguments (`views` takes an `op`), or `catalog` for
 * the volume list, or `open` for the two verbs that need the human (a path or a dialog).
 */
export const VERBS = [
  {
    name: 'open_scan',
    title: 'Open a local CBCT scan',
    description:
      'Point the viewer at a local CBCT export: a folder, a DICOMDIR, a multiframe DICOM file, one slice of a series, or a single 2D radiograph file. The scan is read in place and never leaves the machine. Returns the volume catalog. Navigation only: this tool never interprets the images.',
    inputSchema: z.object({
      path: z.string().describe('Absolute local path to the export folder, DICOMDIR, or DICOM file'),
    }),
    outputSchema: OPEN_OUT,
    annotations: NAV,
    route: { kind: 'open' },
  },
  {
    name: 'pick_scan',
    title: 'Let the human pick a scan',
    description:
      'Open the native file dialog on the machine running the viewer so the human chooses the export. The chosen path stays on that machine: the result carries the display label and the catalog, never the path. Cancel is a normal outcome ({ canceled: true }). The call waits while the dialog is open (up to five minutes).',
    inputSchema: z.object({
      kind: z.enum(['folder', 'file']).optional().describe('folder (default): an export tree; file: one DICOMDIR, multiframe, slice, or radiograph'),
    }),
    outputSchema: OPEN_OUT,
    annotations: NAV,
    route: { kind: 'open' },
  },
  {
    name: 'list_volumes',
    title: 'List openable volumes',
    description:
      'List every volume the viewer can display: user-opened local volumes, session-stitched fusions, and the built-in synthetic demo phantom. Returns ids plus technical geometry (dimensions, voxel spacing, field of view).',
    inputSchema: z.object({}),
    outputSchema: CATALOG_OUT,
    annotations: READ,
    route: { kind: 'catalog' },
  },
  {
    name: 'select_volume',
    title: 'Select a volume',
    description: 'Display the volume with the given id (from list_volumes) in the viewer.',
    inputSchema: z.object({ id: z.string().describe('Volume id, e.g. local_…, fused_…, or demo_…') }),
    outputSchema: STATE_OUT,
    annotations: NAV,
    route: { kind: 'bridge', verb: 'select_volume' },
  },
  {
    name: 'viewer_state',
    title: 'Read the viewer state',
    description:
      'What is on screen right now: selected volume, reading mode, window, inversion, slice positions in the pane count with direction (MPR), grid window or pano arch position, 3D style, and the saved views of this volume. Read-only; the same data every mutating verb returns.',
    inputSchema: z.object({}),
    outputSchema: STATE_OUT,
    annotations: READ,
    route: { kind: 'bridge', verb: 'get_state' },
  },
  {
    name: 'set_view_mode',
    title: 'Switch reading mode',
    description:
      'Switch the reading mode: mpr (orthogonal slices + 3D), grid (parallel slices), pano (curved panoramic + cross-sections), tmj (axis-corrected condyle sections), reslice (stack along a drawn path), ceph (virtual cephalogram), region (region growing + airway), stitch (register two volumes).',
    inputSchema: z.object({ mode: z.enum(VIEW_MODES) }),
    outputSchema: STATE_OUT,
    annotations: NAV,
    route: { kind: 'bridge', verb: 'set_view_mode' },
  },
  {
    name: 'set_window_level',
    title: 'Set window/level',
    description:
      'Set the HU display window: either a preset (Auto, Bone, Teeth, Soft) or an explicit center/width. Optionally toggle grayscale inversion. Visualization only: it changes how voxels map to gray values.',
    inputSchema: z.object({
      preset: z.enum(WL_PRESETS).optional(),
      center: z.number().optional().describe('window center in HU'),
      width: z.number().optional().describe('window width in HU (≥ 1)'),
      invert: z.boolean().optional(),
    }),
    outputSchema: STATE_OUT,
    annotations: NAV,
    route: { kind: 'bridge', verb: 'set_window_level' },
  },
  {
    name: 'set_3d_style',
    title: 'Set the 3D rendering style',
    description:
      "Pick the 3D pane's rendering style (MPR mode). style:* are the generic styles, cbct:* the CBCT presets; each loads its own default threshold. CT-Air is the library's air preset, applied as it is (the Air chip). Visualization only.",
    inputSchema: z.object({ style: z.enum(STYLES_3D) }),
    outputSchema: STATE_OUT,
    annotations: NAV,
    route: { kind: 'bridge', verb: 'set_3d_style' },
  },
  {
    name: 'navigate_slice',
    title: 'Navigate slices',
    description:
      'Move to a slice, in the pane\'s own count: 0-based, counting the way the on-screen label does (axial superior→inferior, coronal posterior→anterior, sagittal right→left), so the pane labelled "AXIAL 622/801 S→I" is index 621. Give an absolute index or a delta (positive = toward the label\'s "to" end). MPR: moves that pane. Grid: moves the window centre along the grid\'s plane (pane switches the plane; delta steps one grid spacing). Pano: pane axial moves the axial editor slice. Other modes have no slice to move.',
    inputSchema: z.object({
      pane: z.enum(PANES).optional().describe('required in MPR and pano (axial); in grid it selects the plane, default the current one'),
      index: z.number().int().optional().describe("absolute slice index, 0-based, in the pane's own count (label number minus 1)"),
      delta: z.number().int().optional().describe('offset from the current slice; in grid, whole grid spacings'),
    }),
    outputSchema: STATE_OUT,
    annotations: NAV,
    route: { kind: 'bridge', verb: 'navigate_slice' },
  },
  {
    name: 'navigate_arch',
    title: 'Move along the arch (pano)',
    description:
      'Pano mode: center the cross-sections at a position along the drawn arch, in mm from the patient-right end (the on-screen arc ruler). Give an absolute position_mm or a delta_mm. Needs an arch; the human draws it (no verb draws anatomy).',
    inputSchema: z.object({
      position_mm: z.number().optional(),
      delta_mm: z.number().optional(),
    }),
    outputSchema: STATE_OUT,
    annotations: NAV,
    route: { kind: 'bridge', verb: 'navigate_arch' },
  },
  {
    name: 'reset_view',
    title: 'Reset the view',
    description:
      'Reset camera orientation to orthogonal. With full=true also resets window/level, inversion, and gamma to the volume defaults.',
    inputSchema: z.object({ full: z.boolean().optional() }),
    outputSchema: STATE_OUT,
    annotations: NAV,
    route: { kind: 'bridge', verb: 'reset_view' },
  },
  {
    name: 'list_views',
    title: 'List saved views',
    description:
      'The saved views of the selected volume (MPR mode): id, name, and who saved it (reader or agent). A saved view is a presentation (cameras, window, render settings), not a finding.',
    inputSchema: z.object({}),
    outputSchema: VIEWS_OUT,
    annotations: READ,
    route: { kind: 'bridge', verb: 'views', args: { op: 'list' } },
  },
  {
    name: 'goto_view',
    title: 'Restore a saved view',
    description: 'Restore a saved view by id or exact name (MPR mode): cameras, window, and render settings return to that presentation.',
    inputSchema: z.object({ view: z.string().describe('view id (view-…) or its exact name') }),
    outputSchema: STATE_OUT,
    annotations: NAV,
    route: { kind: 'bridge', verb: 'views', args: { op: 'goto' } },
  },
  {
    name: 'save_view',
    title: 'Save the current view',
    description:
      "Bookmark the current presentation under a name (MPR mode). The view is written to the volume's annotation sidecar marked as agent-saved, and the viewer shows it with an agent badge so the reader never mistakes it for their own. Name a location or a task, never a finding.",
    inputSchema: z.object({ name: z.string().min(1).max(80) }),
    outputSchema: STATE_OUT,
    annotations: ADD,
    route: { kind: 'bridge', verb: 'views', args: { op: 'save' } },
  },
  {
    name: 'snapshot',
    title: 'Snapshot the current view',
    description:
      "Capture the current viewing area (all visible panes) as a PNG image, with a one-line caption of the viewer state so the picture is never read out of context. Returns the pixels only; interpreting them is the human reader's job.",
    inputSchema: z.object({}),
    outputSchema: STATE_OUT,
    annotations: READ,
    route: { kind: 'bridge', verb: 'snapshot' },
  },
];

/** one verb by name (throws on an unknown name: the set is closed) */
export function verb(name) {
  const v = VERBS.find((x) => x.name === name);
  if (!v) throw new Error(`unknown verb: ${name}`);
  return v;
}

/** The MCP registration config of one verb (no route: that is the page's business). */
export function toolConfig(name) {
  const { title, description, inputSchema, outputSchema, annotations } = verb(name);
  return { title, description, inputSchema, outputSchema, annotations };
}

/**
 * A verb's input schema as JSON Schema, by Zod's own export, with the settings the MCP SDK
 * uses for tools/list (draft 2020-12, the input side), so the page's tools and the server's
 * listed tools are the same schema. The `$schema` key is dropped: providers do not want it.
 */
export function inputJsonSchema(name) {
  const schema = z.toJSONSchema(verb(name).inputSchema, { target: 'draft-2020-12', io: 'input' });
  delete schema.$schema;
  return { type: 'object', ...schema };
}

/** The fence, as the MCP prompts and the in-page agent's system prompt both open with it. */
export const FENCE =
  'You are operating the CBCTScope viewer for a human reader. Use only the cbctscope tools. Move the camera, window the image, take snapshots; do not describe, interpret, or diagnose what the images show. Hand the snapshots to the reader with their captions and stop.';

/** One line a reader or an agent can scan: what is on screen, in the pane's own words. */
export function describe(state) {
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
