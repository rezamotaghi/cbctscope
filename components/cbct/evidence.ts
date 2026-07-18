// Evidence layer plumbing:
//  - saved views: a named snapshot of all four pane cameras + the read-state controls, so a
//    region's exact presentation can be returned to with one click;
//  - snapshots: compose the visible pane canvases + their annotation SVG layers into one PNG
//    (stills for teaching files / figures);
//  - the persistence sidecar client: annotations, views, and 3D ROIs round-trip through
//    /api/cbct/[anon]/evidence as one JSON file per volume, so marks survive close/reopen.
//    World coordinates only — the volume's FrameOfReference is deterministic per anon id,
//    so a restored annotation lands exactly where it was drawn.
import type { CbctControls } from './CbctViewport';
import type { Roi3d } from './evidence3d';

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
    const r = await fetch(`/api/cbct/${anon}/evidence`);
    if (!r.ok) return null;
    const j = (await r.json()) as EvidenceFile & { exists?: boolean };
    if (j.exists === false || j.schema !== EVIDENCE_SCHEMA) return null;
    return j;
  } catch {
    return null;
  }
}

export async function putEvidence(file: EvidenceFile): Promise<boolean> {
  try {
    const r = await fetch(`/api/cbct/${file.anon}/evidence`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(file),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ---------------- snapshot composition ----------------

export interface SnapPane {
  canvas: HTMLCanvasElement;
  /** the Cornerstone annotation SVG layer over the canvas (null ⇒ canvas only) */
  svg: SVGSVGElement | null;
  label: string;
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
    ctx.fillStyle = '#dfe5f0';
    ctx.fillText(p.label, x + 8, y + 6);
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
