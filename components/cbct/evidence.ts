// Evidence layer plumbing:
//  - saved views: a named snapshot of all four pane cameras + the read-state controls, so a
//    region's exact presentation can be returned to with one click;
//  - snapshots: compose the visible pane canvases + their annotation SVG layers into one PNG
//    (stills for teaching files / figures);
//  - the persistence sidecar client: annotations, views, and 3D ROIs round-trip through the
//    volume source (./source) as one JSON record per volume, so marks survive close/reopen.
//    World coordinates only — the volume's FrameOfReference is deterministic per anon id,
//    so a restored annotation lands exactly where it was drawn.
import { z } from 'zod';
import type { CbctControls } from './CbctViewport';
import type { Roi3d } from './evidence3d';
import { source } from './source';

export interface SavedCam {
  position: number[];
  focalPoint: number[];
  viewUp: number[];
  parallelScale?: number;
}

export interface SavedView {
  id: string;
  name: string;
  /** per-viewport-id cameras (the three MPR panes + the 3D render) */
  cameras: Record<string, SavedCam>;
  /** the read-state controls to restore alongside the cameras */
  patch: Partial<CbctControls>;
  /** who saved it: absent = the reader at the keyboard; 'agent' = over the agent bridge (badged in the UI) */
  by?: 'agent';
}

export const EVIDENCE_SCHEMA = 'cbctscope-evidence-v1' as const;

export interface EvidenceFile {
  schema: typeof EVIDENCE_SCHEMA;
  anon: string;
  saved_at: string;
  /** serialized Cornerstone annotations (plain JSON — world-coordinate handles) */
  annotations: unknown[];
  views: SavedView[];
  rois3d: Roi3d[];
  /** nerve / root-canal traces (pano workflow) — additive, absent in older files */
  traces?: unknown[];
}

/**
 * Read-merge-write a partial update into a volume's sidecar. The pano view owns `traces`,
 * the MPR view owns annotations/views/rois3d — each writes through here (or preserves the
 * other's fields), so neither clobbers the other's work.
 */
export async function mergeEvidence(
  anon: string,
  patch: Partial<Omit<EvidenceFile, 'schema' | 'anon' | 'saved_at'>>,
): Promise<boolean> {
  const base = (await fetchEvidence(anon)) ?? {
    schema: EVIDENCE_SCHEMA,
    anon,
    saved_at: '',
    annotations: [],
    views: [],
    rois3d: [],
  };
  return putEvidence({ ...base, ...patch, schema: EVIDENCE_SCHEMA, anon, saved_at: new Date().toISOString() });
}

/**
 * Strip an annotation set down to persistable JSON: runtime-only flags dropped, cached stats
 * dropped (recomputed on restore via `invalidated`). Annotations that refuse to serialize
 * (shouldn't happen — they're plain data) are skipped rather than poisoning the file.
 */
export function serializeAnnotations(annotations: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const a of annotations) {
    try {
      const c = JSON.parse(JSON.stringify(a)) as {
        highlighted?: boolean;
        invalidated?: boolean;
        data?: { cachedStats?: unknown };
      };
      delete c.highlighted;
      c.invalidated = true;
      if (c.data?.cachedStats) c.data.cachedStats = {};
      out.push(c);
    } catch {
      /* skip the unserializable one */
    }
  }
  return out;
}

export async function fetchEvidence(anon: string): Promise<EvidenceFile | null> {
  try {
    const raw = await source.getEvidence(anon);
    if (!raw) return null;
    // a stored record passes the same validation as a loaded file before anything restores it
    const checked = validateEvidence(raw, anon);
    return 'file' in checked ? checked.file : null;
  } catch {
    return null;
  }
}

export async function putEvidence(file: EvidenceFile): Promise<boolean> {
  try {
    return await source.putEvidence(file);
  } catch {
    return false;
  }
}

/** every string inside `v` with `from` replaced by `to` (plain JSON in, plain JSON out) */
function rekeyStrings(v: unknown, from: string, to: string): unknown {
  if (typeof v === 'string') return v.split(from).join(to);
  if (Array.isArray(v)) return v.map((x) => rekeyStrings(x, from, to));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rekeyStrings(x, from, to)]));
  }
  return v;
}

// ---------------- the marks-file schema ----------------
// Zod schemas for what a marks file (or a stored sidecar) may carry. An entry that fails is
// dropped and counted, never restored; the rest loads. Fields the viewer does not read pass
// through (loose objects), the ones it does are typed.

/** the annotation tools whose marks the viewer restores (Cornerstone toolName values) */
export const MARK_TOOLS = ['Length', 'Angle', 'ArrowAnnotate', 'Label', 'RectangleROI', 'EllipticalROI', 'PlanarFreehandROI'] as const;

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);

export const AnnotationSchema = z.looseObject({
  annotationUID: z.string().max(200).optional(),
  metadata: z.looseObject({
    toolName: z.enum(MARK_TOOLS),
    FrameOfReferenceUID: z.string().max(200).optional(),
    referencedImageId: z.string().max(2000).optional(),
    volumeId: z.string().max(2000).optional(),
    viewPlaneNormal: vec3.optional(),
    viewUp: vec3.optional(),
    cameraPosition: vec3.optional(),
    cameraFocalPoint: vec3.optional(),
  }),
  data: z.looseObject({
    handles: z.looseObject({ points: z.array(vec3).max(10_000) }),
    label: z.string().max(10_000).optional(),
    text: z.string().max(10_000).optional(),
  }),
});

const CamSchema = z.object({
  position: vec3,
  focalPoint: vec3,
  viewUp: vec3,
  parallelScale: finite.optional(),
});

export const SavedViewSchema = z.object({
  id: z.string().max(200),
  name: z.string().max(500),
  cameras: z.record(z.string().max(100), CamSchema),
  patch: z.record(z.string().max(100), z.unknown()),
  by: z.literal('agent').optional(),
});

export const RoiSchema = z.object({
  id: z.string().max(200),
  center: vec3,
  axes: z.tuple([vec3, vec3, vec3]),
  half: vec3,
  stats: z.object({ nVoxels: finite, meanHu: finite, sdHu: finite, minHu: finite, maxHu: finite, volumeCm3: finite }),
  visible: z.boolean().optional().default(true),
});

const EvidenceShape = z.object({
  schema: z.literal(EVIDENCE_SCHEMA),
  anon: z.string().max(200).optional(),
  saved_at: z.string().max(100).optional(),
  annotations: z.array(z.unknown()).max(100_000).optional(),
  views: z.array(z.unknown()).max(10_000).optional(),
  rois3d: z.array(z.unknown()).max(10_000).optional(),
  traces: z.array(z.unknown()).max(10_000).optional(),
});

/** each entry that passes `schema`, and how many did not */
function keep<T>(items: unknown[] | undefined, schema: z.ZodType<T>): { ok: T[]; dropped: number } {
  const ok: T[] = [];
  let dropped = 0;
  for (const it of items ?? []) {
    const r = schema.safeParse(it);
    if (r.success) ok.push(r.data);
    else dropped++;
  }
  return { ok, dropped };
}

/**
 * Validate a parsed marks file or stored sidecar for the volume `anon` and re-key it there.
 * The volume id is not required to match: the local app and the web build derive different
 * ids for the same export, so a file saved by one must load in the other. The file is
 * re-keyed to `anon`, including the old id inside the annotations' own metadata (the
 * FrameOfReference `cbctscope.<id>` and the volume references), so a restored mark is bound
 * to the volume on screen and nothing else. Entries that fail their schema are dropped and
 * counted. Never throws: a hostile file (deep nesting that overflows the stack) becomes a
 * plain sentence.
 */
export function validateEvidence(j: unknown, anon: string): { file: EvidenceFile; dropped: number } | { error: string } {
  try {
    const top = EvidenceShape.safeParse(j);
    if (!top.success) return { error: 'That file is not a CBCTScope marks file.' };
    const t = top.data;
    const from = t.anon && t.anon !== anon ? t.anon : null;
    const rekey = (v: unknown[] | undefined): unknown[] | undefined => (v && from ? (rekeyStrings(v, from, anon) as unknown[]) : v);
    const annotations = keep(rekey(t.annotations), AnnotationSchema);
    const views = keep(rekey(t.views), SavedViewSchema);
    const rois = keep(rekey(t.rois3d), RoiSchema);
    const file: EvidenceFile = {
      schema: EVIDENCE_SCHEMA,
      anon,
      saved_at: t.saved_at ?? new Date().toISOString(),
      annotations: annotations.ok,
      views: views.ok as SavedView[],
      rois3d: rois.ok as Roi3d[],
      // pano traces have their own sanitiser (traces.ts sanitizeTraces) on restore
      ...(t.traces ? { traces: rekey(t.traces) } : {}),
    };
    return { file, dropped: annotations.dropped + views.dropped + rois.dropped };
  } catch (err) {
    if (err instanceof RangeError) return { error: 'That marks file is nested too deeply to read.' };
    return { error: 'That marks file could not be read.' };
  }
}

/**
 * Parse a marks file the reader loads ("Load marks from file") for the volume on screen:
 * JSON, then validateEvidence. Returns the file and the number of entries dropped, or a
 * sentence for the reader. Nothing is stored here; the caller stores only a valid file.
 */
export function parseMarksFile(text: string, anon: string): { file: EvidenceFile; dropped: number } | { error: string } {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch (err) {
    if (err instanceof RangeError) return { error: 'That marks file is nested too deeply to read.' };
    return { error: 'That file is not a CBCTScope marks file (it is not JSON).' };
  }
  return validateEvidence(j, anon);
}

// ---------------- snapshot composition ----------------

export interface SnapPane {
  canvas: HTMLCanvasElement;
  /** the Cornerstone annotation SVG layer over the canvas (null ⇒ canvas only) */
  svg: SVGSVGElement | null;
  label: string;
  /** the window readout drawn bottom right ("W 4000 L 1000"), as the pane shows it */
  wl?: string;
  /** the scale bar drawn bottom centre: its length as a fraction of the pane width, and its label */
  scale?: { frac: number; label: string };
}

function svgToImage(svg: SVGSVGElement): Promise<HTMLImageElement | null> {
  try {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return Promise.resolve(null);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', String(rect.width));
    clone.setAttribute('height', String(rect.height));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const s = new XMLSerializer().serializeToString(clone);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = url;
    });
  } catch {
    return Promise.resolve(null);
  }
}

/**
 * Tile the panes (1 → single, else 2 columns) into one PNG data-URL: rendered image first,
 * annotation SVG stretched over it, pane label top-left, footer (case id · timestamp)
 * bottom-right of the composite.
 */
export async function composeSnapshot(panes: SnapPane[], footer: string): Promise<string | null> {
  if (!panes.length) return null;
  const gap = 4;
  const cols = panes.length > 1 ? 2 : 1;
  const rows = Math.ceil(panes.length / cols);
  const tw = Math.max(...panes.map((p) => p.canvas.width));
  const th = Math.max(...panes.map((p) => p.canvas.height));
  if (!tw || !th) return null;
  const out = document.createElement('canvas');
  out.width = cols * tw + (cols - 1) * gap;
  out.height = rows * th + (rows - 1) * gap;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, out.width, out.height);
  const fs = Math.max(14, Math.round(tw / 45)); // scale the labels with the capture resolution
  for (let i = 0; i < panes.length; i++) {
    const p = panes[i];
    const x = (i % cols) * (tw + gap);
    const y = Math.floor(i / cols) * (th + gap);
    ctx.drawImage(p.canvas, x, y);
    if (p.svg) {
      const img = await svgToImage(p.svg);
      if (img) ctx.drawImage(img, x, y, p.canvas.width, p.canvas.height);
    }
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#e6e9ef';
    ctx.fillText(p.label, x + 8, y + 6);
    ctx.font = `${fs}px system-ui, sans-serif`;
    ctx.textBaseline = 'bottom';
    if (p.wl) ctx.fillText(p.wl, x + p.canvas.width - ctx.measureText(p.wl).width - 8, y + p.canvas.height - 6);
    if (p.scale) {
      const bw = p.scale.frac * p.canvas.width;
      const tw2 = ctx.measureText(p.scale.label).width;
      const bx = x + (p.canvas.width - bw - fs / 2 - tw2) / 2;
      const by = y + p.canvas.height - 6 - fs * 1.6;
      ctx.strokeStyle = '#ffd54a';
      ctx.fillStyle = '#ffd54a';
      ctx.lineWidth = Math.max(2, fs / 7);
      ctx.beginPath();
      ctx.moveTo(bx, by - fs / 2);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw, by - fs / 2);
      ctx.stroke();
      ctx.fillText(p.scale.label, bx + bw + fs / 2, by + fs / 3);
    }
    ctx.shadowBlur = 0;
  }
  ctx.font = `${fs}px system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#aeb6c6';
  ctx.fillText(footer, out.width - ctx.measureText(footer).width - 10, out.height - 8);
  ctx.shadowBlur = 0;
  try {
    return out.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Grid-mode snapshot: the scout (scaled to the stack's full height) beside the rows×cols
 * tile block — mirrors the on-screen layout instead of the 2-column default above. Same
 * label + footer conventions as composeSnapshot.
 */
export async function composeGridSnapshot(
  scout: SnapPane | null,
  tiles: SnapPane[],
  cols: number,
  footer: string,
): Promise<string | null> {
  if (!tiles.length) return null;
  const gap = 4;
  const rows = Math.ceil(tiles.length / cols);
  const tw = Math.max(...tiles.map((p) => p.canvas.width));
  const th = Math.max(...tiles.map((p) => p.canvas.height));
  if (!tw || !th) return null;
  const gridW = cols * tw + (cols - 1) * gap;
  const gridH = rows * th + (rows - 1) * gap;
  const sw = scout && scout.canvas.height ? Math.round((scout.canvas.width * gridH) / scout.canvas.height) : 0;
  const out = document.createElement('canvas');
  out.width = (sw ? sw + gap : 0) + gridW;
  out.height = gridH;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, out.width, out.height);
  const fs = Math.max(14, Math.round(tw / 45));
  const label = (text: string, x: number, y: number) => {
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#dfe5f0';
    ctx.fillText(text, x + 8, y + 6);
    ctx.shadowBlur = 0;
  };
  if (scout && sw) {
    ctx.drawImage(scout.canvas, 0, 0, sw, gridH);
    if (scout.svg) {
      const img = await svgToImage(scout.svg);
      if (img) ctx.drawImage(img, 0, 0, sw, gridH);
    }
    label(scout.label, 0, 0);
  }
  const x0 = sw ? sw + gap : 0;
  for (let i = 0; i < tiles.length; i++) {
    const p = tiles[i];
    const x = x0 + (i % cols) * (tw + gap);
    const y = Math.floor(i / cols) * (th + gap);
    ctx.drawImage(p.canvas, x, y);
    if (p.svg) {
      const img = await svgToImage(p.svg);
      if (img) ctx.drawImage(img, x, y, p.canvas.width, p.canvas.height);
    }
    label(p.label, x, y);
  }
  ctx.font = `${fs}px system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#aeb6c6';
  ctx.fillText(footer, out.width - ctx.measureText(footer).width - 10, out.height - 8);
  ctx.shadowBlur = 0;
  try {
    return out.toDataURL('image/png');
  } catch {
    return null;
  }
}
