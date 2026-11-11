// The image panes' overlay grammar, one place for every reading mode: what sits in which
// corner, the plane colours, the window readout, the scale bar's length, and the box test
// that keeps two overlays from landing on each other. Pure: no React, no Cornerstone, unit
// tested in tests/overlayGrammar.test.ts. The React pieces that draw it live in PaneOverlay.tsx.

export type Plane = 'axial' | 'sagittal' | 'coronal';

/**
 * Plane identity colours (axial red, sagittal yellow, coronal green), each at least 4.5:1 on
 * the dark ground with the halo under it. The plane lines in the panes use the same hues.
 */
export const PLANE_COLOR: Record<Plane, string> = {
  axial: '#ff5a5a',
  sagittal: '#e1c832',
  coronal: '#46c85a',
};

/** the dark halo under every line of overlay text: legible on bright bone and on air alike */
export const OVERLAY_HALO = '0 0 2px #000, 0 0 3px #000, 0 1px 2px #000';

/** "W 4000 L 1000": the window shown in a pane, whole numbers, width first as on the comparables */
export function wlText(voi: { center: number; width: number }): string {
  return `W ${Math.round(voi.width)} L ${Math.round(voi.center)}`;
}

const SCALE_STEPS_MM = [1, 2, 5, 10, 20, 50, 100, 200];

/**
 * The scale bar for a pane: the longest round length (1, 2, 5, 10, 20, 50 mm and so on) whose
 * bar fits in `maxFrac` of the pane's width, and its length in CSS px. Null when the pane is
 * not laid out, even 1 mm will not fit, or the bar would be shorter than 16 px.
 * @param mmPerPx world mm per CSS pixel on the pane
 * @param paneWidthPx the pane's width in CSS pixels
 */
export function scaleBar(
  mmPerPx: number,
  paneWidthPx: number,
  maxFrac = 0.25,
): { mm: number; px: number; label: string } | null {
  if (!(mmPerPx > 0) || !(paneWidthPx > 0) || !Number.isFinite(mmPerPx)) return null;
  const maxPx = paneWidthPx * maxFrac;
  let best: number | null = null;
  for (const mm of SCALE_STEPS_MM) if (mm / mmPerPx <= maxPx) best = mm;
  // a bar shorter than 16 px reads as a tick, not a scale
  if (best === null || best / mmPerPx < 16) return null;
  return { mm: best, px: best / mmPerPx, label: best >= 10 && best % 10 === 0 ? `${best / 10} cm` : `${best} mm` };
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** true when two boxes share more than `tol` px in both directions (touching edges do not count) */
export function boxesOverlap(a: Box, b: Box, tol = 0.5): boolean {
  return Math.min(a.right, b.right) - Math.max(a.left, b.left) > tol && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tol;
}

/** every pair of indices whose boxes overlap */
export function overlappingPairs(boxes: Box[], tol = 0.5): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) if (boxesOverlap(boxes[i], boxes[j], tol)) out.push([i, j]);
  }
  return out;
}

/**
 * Where to draw a label of size w by h so it stays inside a canvas of size W by H with `pad`
 * to spare: the wanted top-left corner, moved in only as far as the edges need.
 */
export function clampLabel(x: number, y: number, w: number, h: number, W: number, H: number, pad = 2): { x: number; y: number } {
  return {
    x: Math.max(pad, Math.min(x, W - w - pad)),
    y: Math.max(pad, Math.min(y, H - h - pad)),
  };
}

/**
 * Draw a measurement or caption on a canvas that is shown scaled (object-fit: contain): the
 * text is `cssPx` tall on screen whatever the backing resolution, sits on a dark halo, and is
 * kept inside the canvas. `x`, `y` are the wanted left and baseline in canvas pixels.
 */
export function drawHaloLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  cssPx = 12,
): void {
  const cv = ctx.canvas;
  const shown = cv.getBoundingClientRect?.();
  const scale = shown && shown.width > 0 && shown.height > 0 ? Math.max(cv.width / shown.width, cv.height / shown.height) : 1;
  const fs = Math.max(6, cssPx * scale);
  ctx.save();
  ctx.font = `${fs}px system-ui, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(text).width;
  const p = clampLabel(x, y - fs, w, fs * 1.25, cv.width, cv.height, 2 * scale);
  const baseline = p.y + fs;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, 3 * scale);
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, p.x, baseline);
  ctx.fillStyle = color;
  ctx.fillText(text, p.x, baseline);
  ctx.restore();
}
