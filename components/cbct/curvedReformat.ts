'use client';
// Curved planar reformation (CPR) math for the CBCT pano workflow — pure CPU, no Cornerstone.
//
// The reader clicks control points along the dental arch on an axial slice. We fit a
// Catmull-Rom spline (a smooth curve through the points), resample it at uniform TRUE-mm
// arc-length steps, and then:
//   - PANO: "unroll" the volume along the curve — each pano column is the average (or max)
//     of samples taken across a slab perpendicular to the curve; rows are the z slices.
//   - CROSS-SECTIONS: planes perpendicular to the curve at a chosen arc position — the view
//     every implant/impaction read lives in.
// All geometry is true mm (isotropic voxels). Performance trick: the in-plane bilinear
// weights for every (column, slab-offset) sample are identical across all z slices, so we
// precompute them once and the per-slice inner loop is pure multiply-adds.
import type { VolumeEntry } from './volumeData';

export interface ArchPoint {
  x: number; // mm, volume image space (x = patient left+)
  y: number; // mm (y = posterior+)
}

export interface ArchCurve {
  /** uniform arc-length samples [x0,y0, x1,y1, ...] in mm */
  pts: Float64Array;
  /** unit normals per sample [nx0,ny0, ...] (90° CCW from tangent) */
  normals: Float64Array;
  /** mm between consecutive samples */
  step: number;
  /** total arc length mm */
  length: number;
  count: number;
}

/** Catmull-Rom through the control points → uniform arc-length polyline + normals. */
export function buildArchCurve(points: ArchPoint[], step: number): ArchCurve | null {
  if (points.length < 3) return null;
  // endpoint duplication so the spline passes through the first/last control point
  const P = [points[0], ...points, points[points.length - 1]];
  const dense: number[] = [];
  const SUB = 24;
  for (let i = 0; i < P.length - 3; i++) {
    const [p0, p1, p2, p3] = [P[i], P[i + 1], P[i + 2], P[i + 3]];
    for (let j = 0; j < SUB; j++) {
      const t = j / SUB;
      const t2 = t * t;
      const t3 = t2 * t;
      dense.push(
        0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      );
    }
  }
  dense.push(points[points.length - 1].x, points[points.length - 1].y);

  // cumulative arc length over the dense polyline
  const n = dense.length / 2;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const dx = dense[2 * i] - dense[2 * i - 2];
    const dy = dense[2 * i + 1] - dense[2 * i - 1];
    cum[i] = cum[i - 1] + Math.hypot(dx, dy);
  }
  const length = cum[n - 1];
  if (length < step * 4) return null;

  // resample at uniform arc-length steps
  const count = Math.floor(length / step) + 1;
  const pts = new Float64Array(count * 2);
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const s = Math.min(i * step, length);
    while (seg < n - 2 && cum[seg + 1] < s) seg++;
    const span = cum[seg + 1] - cum[seg] || 1;
    const f = (s - cum[seg]) / span;
    pts[2 * i] = dense[2 * seg] + f * (dense[2 * seg + 2] - dense[2 * seg]);
    pts[2 * i + 1] = dense[2 * seg + 1] + f * (dense[2 * seg + 3] - dense[2 * seg + 1]);
  }

  // unit normals from central-difference tangents
  const normals = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(count - 1, i + 1);
    const tx = pts[2 * i1] - pts[2 * i0];
    const ty = pts[2 * i1 + 1] - pts[2 * i0 + 1];
    const m = Math.hypot(tx, ty) || 1;
    normals[2 * i] = -ty / m;
    normals[2 * i + 1] = tx / m;
  }
  return { pts, normals, step, length, count };
}

/** Precomputed bilinear taps for one in-plane (x,y) point, reused across every z slice. */
interface Tap {
  i00: number; i10: number; i01: number; i11: number;
  w00: number; w10: number; w01: number; w11: number;
}

function makeTap(xMm: number, yMm: number, sx: number, sy: number, cols: number, rows: number): Tap | null {
  const fx = xMm / sx;
  const fy = yMm / sy;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 >= cols - 1 || y0 >= rows - 1) return null;
  const dx = fx - x0;
  const dy = fy - y0;
  return {
    i00: y0 * cols + x0,
    i10: y0 * cols + x0 + 1,
    i01: (y0 + 1) * cols + x0,
    i11: (y0 + 1) * cols + x0 + 1,
    w00: (1 - dx) * (1 - dy),
    w10: dx * (1 - dy),
    w01: (1 - dx) * dy,
    w11: dx * dy,
  };
}

export interface ReformatImage {
  /** HU values, row-major; row 0 = SUPERIOR (max z) */
  data: Int16Array;
  width: number;
  height: number;
  /** mm per pixel horizontally / vertically */
  pxW: number;
  pxH: number;
}

const AIR = -1000;

/** Inclusive z-slice window (vertical trim window): trims skull base / hyoid out of a reformat. */
export interface ZRange {
  zLo: number;
  zHi: number;
}

/** Sample columns × the z window through a set of taps per column (slab avg or MIP). */
function sweep(
  entry: VolumeEntry,
  tapsPerCol: (Tap | null)[][],
  mip: boolean,
  range?: ZRange,
): ReformatImage {
  const [cols, rows, slices] = entry.meta.dims;
  const zLo = Math.max(0, Math.min(slices - 1, range?.zLo ?? 0));
  const zHi = Math.max(zLo, Math.min(slices - 1, range?.zHi ?? slices - 1));
  const scalar = entry.scalar;
  const sliceLen = cols * rows;
  const width = tapsPerCol.length;
  const height = zHi - zLo + 1;
  const out = new Int16Array(width * height);
  for (let j = 0; j < height; j++) {
    const z = zHi - j; // row 0 = superior (top of the kept window)
    const base = z * sliceLen;
    const rowOff = j * width;
    for (let i = 0; i < width; i++) {
      const taps = tapsPerCol[i];
      let acc = mip ? -32768 : 0;
      let k = 0;
      for (const t of taps) {
        if (!t) continue;
        const v =
          scalar[base + t.i00] * t.w00 +
          scalar[base + t.i10] * t.w10 +
          scalar[base + t.i01] * t.w01 +
          scalar[base + t.i11] * t.w11;
        if (mip) {
          if (v > acc) acc = v;
        } else {
          acc += v;
        }
        k++;
      }
      out[rowOff + i] = k === 0 ? AIR : mip ? acc : acc / k;
    }
  }
  return { data: out, width, height, pxW: entry.meta.spacing[0], pxH: entry.meta.spacing[2] };
}

export interface PanoOpts {
  /** slide the whole sampling curve buccal(−)/lingual(+) without redrawing (radius shift) */
  shiftMm?: number;
  /** per-curve-sample extra normal offset (adaptive layer) — indexed like curve samples */
  focusOffsets?: Float32Array | null;
  range?: ZRange;
  /** the section fan's in-plane tilt (deg): the pano re-cuts with the same leaning
   *  vertical, so verticals match the tilted sections (rigid-frame behavior). */
  tiltDeg?: number;
}

/** Curved pano: one column per curve sample, slab across the arch normal. */
export function renderPano(
  entry: VolumeEntry,
  curve: ArchCurve,
  slabMm: number,
  mip: boolean,
  opts?: PanoOpts,
): ReformatImage {
  const [cols, rows] = entry.meta.dims;
  const [sx, sy] = entry.meta.spacing;
  const offStep = Math.max(sx * 2, 0.4); // slab sampling pitch — averaging low-passes anyway
  const half = Math.max(0, slabMm / 2);
  const offsets: number[] = [];
  for (let o = -half; o <= half + 1e-6; o += offStep) offsets.push(o);
  if (offsets.length === 0) offsets.push(0);
  const shift = opts?.shiftMm ?? 0;
  const focus = opts?.focusOffsets ?? null;

  const tilt = opts?.tiltDeg ?? 0;
  if (Math.abs(tilt) > 0.01) {
    // Tilted frame: each image row leans buccal/lingual with height about the kept-window
    // center — every row shares one z slice and one lateral lean, so this stays a per-row
    // rebuild of the same slab sampling (cost ≈ the upright sweep). Row 0 = superior.
    const spz = entry.meta.spacing[2];
    const slices = entry.meta.dims[2];
    const zLo = Math.max(0, Math.min(slices - 1, opts?.range?.zLo ?? 0));
    const zHi = Math.max(zLo, Math.min(slices - 1, opts?.range?.zHi ?? slices - 1));
    const h = zHi - zLo + 1;
    const zCmm = ((zLo + zHi) / 2) * spz;
    const th = (tilt * Math.PI) / 180;
    const cosT = Math.cos(th);
    const sinT = Math.sin(th);
    const scalar = entry.scalar;
    const sliceLen = cols * rows;
    const W = curve.count;
    const out = new Int16Array(W * h);
    for (let j = 0; j < h; j++) {
      const rowOff = j * W;
      const b = (j - h / 2) * spz; // mm down the image from the window center
      const zi = Math.round((zCmm - b * cosT) / spz);
      if (zi < 0 || zi >= slices) {
        out.fill(-1000, rowOff, rowOff + W);
        continue;
      }
      const lean = b * sinT; // lateral offset along the normal at this height
      const base = zi * sliceLen;
      for (let i = 0; i < W; i++) {
        const boff = shift + (focus ? focus[Math.min(i, focus.length - 1)] : 0) + lean;
        const px = curve.pts[2 * i];
        const py = curve.pts[2 * i + 1];
        const nx = curve.normals[2 * i];
        const ny = curve.normals[2 * i + 1];
        let acc = mip ? -32768 : 0;
        let hits = 0;
        for (const o of offsets) {
          const fx = (px + (boff + o) * nx) / sx;
          const fy = (py + (boff + o) * ny) / sy;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          if (x0 < 0 || y0 < 0 || x0 >= cols - 1 || y0 >= rows - 1) continue;
          const dx = fx - x0;
          const dy = fy - y0;
          const b4 = base + y0 * cols + x0;
          const v =
            scalar[b4] * (1 - dx) * (1 - dy) +
            scalar[b4 + 1] * dx * (1 - dy) +
            scalar[b4 + cols] * (1 - dx) * dy +
            scalar[b4 + cols + 1] * dx * dy;
          if (mip) {
            if (v > acc) acc = v;
          } else acc += v;
          hits++;
        }
        out[rowOff + i] = hits === 0 ? -1000 : mip ? acc : acc / hits;
      }
    }
    return { data: out, width: W, height: h, pxW: curve.step, pxH: spz };
  }

  const tapsPerCol: (Tap | null)[][] = [];
  for (let i = 0; i < curve.count; i++) {
    const base = shift + (focus ? focus[Math.min(i, focus.length - 1)] : 0);
    const px = curve.pts[2 * i];
    const py = curve.pts[2 * i + 1];
    const nx = curve.normals[2 * i];
    const ny = curve.normals[2 * i + 1];
    tapsPerCol.push(offsets.map((o) => makeTap(px + (base + o) * nx, py + (base + o) * ny, sx, sy, cols, rows)));
  }
  const img = sweep(entry, tapsPerCol, mip, opts?.range);
  img.pxW = curve.step; // horizontal = true arc-length mm
  return img;
}

export interface SectionOpts {
  /** slab averaged ALONG the arch (mm) — a thicker, quieter section */
  thicknessMm?: number;
  /** flip which side of the arch faces left (view the section from the other side) */
  mirror?: boolean;
  /** same radius shift as the pano, so sections stay centered on the shifted layer */
  shiftMm?: number;
  range?: ZRange;
  /** in-plane rotation (deg) about the view normal (the arch tangent) — the MPR/grid
   *  "rotate the section you're on" gesture. 0 = the fast upright path. */
  tiltDeg?: number;
}

/** Perpendicular cross-section at arc position sMm, widthMm across the arch normal. */
export function renderSection(
  entry: VolumeEntry,
  curve: ArchCurve,
  sMm: number,
  widthMm: number,
  opts?: SectionOpts,
): ReformatImage {
  const [cols, rows] = entry.meta.dims;
  const [sx, sy] = entry.meta.spacing;
  const i = Math.max(0, Math.min(curve.count - 1, Math.round(sMm / curve.step)));
  const px = curve.pts[2 * i];
  const py = curve.pts[2 * i + 1];
  const nx = curve.normals[2 * i];
  const ny = curve.normals[2 * i + 1];
  // unit tangent (normal is the tangent rotated 90° CCW, so rotate back)
  const tx = ny;
  const ty = -nx;
  const shift = opts?.shiftMm ?? 0;
  const sign = opts?.mirror ? -1 : 1;
  const w = Math.max(8, Math.round(widthMm / sx));
  // thickness taps: sample a few planes along the arch tangent and average them
  const thick = Math.max(0, opts?.thicknessMm ?? 0);
  const tStep = Math.max(sx, 0.2);
  const tOffs: number[] = [];
  for (let t = -thick / 2; t <= thick / 2 + 1e-6; t += tStep) tOffs.push(t);
  if (tOffs.length === 0) tOffs.push(0);

  const tilt = opts?.tiltDeg ?? 0;
  if (Math.abs(tilt) > 0.01) {
    // Tilted section: the image plane spins about its view normal (the arch tangent), so a
    // row is no longer one z slice — the per-z `sweep` model can't express it. Same slab
    // (thickness taps along the tangent), same bilinear-in-xy sampling, nearest z; the
    // in-plane pixel grid is rotated by tilt about the section center (mid kept-z-window).
    const spz = entry.meta.spacing[2];
    const slices = entry.meta.dims[2];
    const zLo = Math.max(0, Math.min(slices - 1, opts?.range?.zLo ?? 0));
    const zHi = Math.max(zLo, Math.min(slices - 1, opts?.range?.zHi ?? slices - 1));
    const h = zHi - zLo + 1;
    const zCmm = ((zLo + zHi) / 2) * spz;
    const th = (tilt * Math.PI) / 180;
    const cosT = Math.cos(th);
    const sinT = Math.sin(th);
    const scalar = entry.scalar;
    const sliceLen = cols * rows;
    const out = new Int16Array(w * h);
    const acc = new Float32Array(w);
    const hits = new Int32Array(w);
    // per-column steps of the rotated in-plane coords: a (screen-right, mm, mirror folded
    // in) rotates into a2 (along the arch normal) and b2 (down): Δa2 = sign·sx·cos,
    // Δb2 = −sign·sx·sin — the row is walked incrementally, no per-pixel allocation
    const dA2 = sign * sx * cosT;
    const dB2 = -sign * sx * sinT;
    for (let j = 0; j < h; j++) {
      acc.fill(0);
      hits.fill(0);
      const b = (j - h / 2) * spz; // mm along screen-down at zero tilt
      const a0 = sign * (0 - w / 2) * sx;
      for (const t of tOffs) {
        let a2 = a0 * cosT + b * sinT;
        let b2 = -a0 * sinT + b * cosT;
        for (let k = 0; k < w; k++) {
          const zi = Math.round((zCmm - b2) / spz);
          if (zi >= 0 && zi < slices) {
            const fx = (px + (shift + a2) * nx + t * tx) / sx;
            const fy = (py + (shift + a2) * ny + t * ty) / sy;
            const x0 = Math.floor(fx);
            const y0 = Math.floor(fy);
            if (x0 >= 0 && y0 >= 0 && x0 < cols - 1 && y0 < rows - 1) {
              const dx = fx - x0;
              const dy = fy - y0;
              const base = zi * sliceLen + y0 * cols + x0;
              acc[k] +=
                scalar[base] * (1 - dx) * (1 - dy) +
                scalar[base + 1] * dx * (1 - dy) +
                scalar[base + cols] * (1 - dx) * dy +
                scalar[base + cols + 1] * dx * dy;
              hits[k]++;
            }
          }
          a2 += dA2;
          b2 += dB2;
        }
      }
      const rowOff = j * w;
      for (let k = 0; k < w; k++) out[rowOff + k] = hits[k] ? acc[k] / hits[k] : -1000;
    }
    return { data: out, width: w, height: h, pxW: sx, pxH: spz };
  }

  const tapsPerCol: (Tap | null)[][] = [];
  for (let k = 0; k < w; k++) {
    const o = shift + sign * (k - w / 2) * sx;
    tapsPerCol.push(
      tOffs.map((t) => makeTap(px + o * nx + t * tx, py + o * ny + t * ty, sx, sy, cols, rows)),
    );
  }
  const img = sweep(entry, tapsPerCol, false, opts?.range);
  img.pxW = sx;
  return img;
}

/**
 * Straight vertical section (no arch curve): the cutting plane passes through (cxMm, cyMm),
 * its image columns run along the in-plane unit direction (dirX, dirY), rows are the z
 * slices. `thicknessMm` averages a slab along the plane's normal (a thicker, quieter cut).
 * This is the TMJ / reslicer primitive — renderSection is the same idea bound to a curve.
 */
export function renderLineSection(
  entry: VolumeEntry,
  cxMm: number,
  cyMm: number,
  dirX: number,
  dirY: number,
  widthMm: number,
  opts?: { thicknessMm?: number; range?: ZRange; mip?: boolean; tiltDeg?: number },
): ReformatImage {
  const [cols, rows] = entry.meta.dims;
  const [sx, sy] = entry.meta.spacing;
  // in-plane normal of the cut (thickness direction)
  const nx = -dirY;
  const ny = dirX;
  const w = Math.max(8, Math.round(widthMm / sx));
  const thick = Math.max(0, opts?.thicknessMm ?? 0);
  const tStep = Math.max(sx, 0.2);
  const tOffs: number[] = [];
  for (let t = -thick / 2; t <= thick / 2 + 1e-6; t += tStep) tOffs.push(t);
  if (tOffs.length === 0) tOffs.push(0);

  const tilt = opts?.tiltDeg ?? 0;
  if (Math.abs(tilt) > 0.01) {
    // Tilted plane: renderSection's tilted branch, straight-geometry edition — the image
    // spins about its view normal, so rows mix z and the column direction; bilinear-in-xy /
    // nearest-z about the kept-window center, incremental walk, slab along the cut normal.
    const spz = entry.meta.spacing[2];
    const slices = entry.meta.dims[2];
    const zLo = Math.max(0, Math.min(slices - 1, opts?.range?.zLo ?? 0));
    const zHi = Math.max(zLo, Math.min(slices - 1, opts?.range?.zHi ?? slices - 1));
    const h = zHi - zLo + 1;
    const zCmm = ((zLo + zHi) / 2) * spz;
    const th = (tilt * Math.PI) / 180;
    const cosT = Math.cos(th);
    const sinT = Math.sin(th);
    const mip = opts?.mip ?? false;
    const scalar = entry.scalar;
    const sliceLen = cols * rows;
    const out = new Int16Array(w * h);
    const acc = new Float32Array(w);
    const hits = new Int32Array(w);
    const dA2 = sx * cosT;
    const dB2 = -sx * sinT;
    for (let j = 0; j < h; j++) {
      acc.fill(mip ? -32768 : 0);
      hits.fill(0);
      const b = (j - h / 2) * spz;
      const a0 = (0 - w / 2) * sx;
      for (const t of tOffs) {
        let a2 = a0 * cosT + b * sinT;
        let b2 = -a0 * sinT + b * cosT;
        for (let k = 0; k < w; k++) {
          const zi = Math.round((zCmm - b2) / spz);
          if (zi >= 0 && zi < slices) {
            const fx = (cxMm + a2 * dirX + t * nx) / sx;
            const fy = (cyMm + a2 * dirY + t * ny) / sy;
            const x0 = Math.floor(fx);
            const y0 = Math.floor(fy);
            if (x0 >= 0 && y0 >= 0 && x0 < cols - 1 && y0 < rows - 1) {
              const dx = fx - x0;
              const dy = fy - y0;
              const base = zi * sliceLen + y0 * cols + x0;
              const v =
                scalar[base] * (1 - dx) * (1 - dy) +
                scalar[base + 1] * dx * (1 - dy) +
                scalar[base + cols] * (1 - dx) * dy +
                scalar[base + cols + 1] * dx * dy;
              if (mip) {
                if (v > acc[k]) acc[k] = v;
              } else acc[k] += v;
              hits[k]++;
            }
          }
          a2 += dA2;
          b2 += dB2;
        }
      }
      const rowOff = j * w;
      for (let k = 0; k < w; k++) out[rowOff + k] = hits[k] === 0 ? -1000 : mip ? acc[k] : acc[k] / hits[k];
    }
    return { data: out, width: w, height: h, pxW: sx, pxH: spz };
  }

  const tapsPerCol: (Tap | null)[][] = [];
  for (let k = 0; k < w; k++) {
    const o = (k - w / 2) * sx;
    tapsPerCol.push(
      tOffs.map((t) => makeTap(cxMm + o * dirX + t * nx, cyMm + o * dirY + t * ny, sx, sy, cols, rows)),
    );
  }
  const img = sweep(entry, tapsPerCol, opts?.mip ?? false, opts?.range);
  img.pxW = sx;
  return img;
}

/** Window a reformat image into RGBA pixels (grayscale) — shared by single and stacked draws. */
export function toImageData(
  img: { data: Int16Array | ArrayLike<number>; width: number; height: number },
  voi: { center: number; width: number },
  invert: boolean,
): ImageData {
  const { width, height } = img;
  const lower = voi.center - voi.width / 2;
  const scale = 255 / Math.max(1, voi.width);
  const id = new ImageData(width, height);
  const px = id.data;
  const data = img.data;
  for (let i = 0, n = width * height; i < n; i++) {
    let g = (Number(data[i]) - lower) * scale;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    if (invert) g = 255 - g;
    const o = i * 4;
    px[o] = px[o + 1] = px[o + 2] = g;
    px[o + 3] = 255;
  }
  return id;
}

/** Window a reformat image (or a raw axial slice) into a canvas at 1 data px = 1 canvas px. */
export function drawImage(
  canvas: HTMLCanvasElement,
  img: { data: Int16Array | ArrayLike<number>; width: number; height: number },
  voi: { center: number; width: number },
  invert: boolean,
): void {
  const { width, height } = img;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    console.warn('[cbct-pano] skipped draw of degenerate image', width, height);
    return;
  }
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.putImageData(toImageData(img, voi, invert), 0, 0);
}

/** Robust display window from a reformat's own pixels (pano auto-adjust, contrast half). */
export function autoWindow(img: ReformatImage): { center: number; width: number } {
  const sample: number[] = [];
  for (let i = 0; i < img.data.length; i += 5) {
    const v = img.data[i];
    if (v > AIR + 50) sample.push(v); // air background would drag the low percentile down
  }
  if (sample.length < 64) return { center: 300, width: 2500 };
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.02)];
  const hi = sample[Math.floor(sample.length * 0.998)];
  const width = Math.max(hi - lo, 200);
  return { center: Math.round(lo + width / 2), width: Math.round(width) };
}

/** Unsharp mask on the HU data (pano auto-adjust, sharpness half): v + amount·(v − mean3×3). */
export function sharpenImage(img: ReformatImage, amount: number): ReformatImage {
  const { width: w, height: h, data } = img;
  const out = new Int16Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1) * w;
    const y1 = y * w;
    const y2 = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x2 = Math.min(w - 1, x + 1);
      const mean =
        (data[y0 + x0] + data[y0 + x] + data[y0 + x2] +
          data[y1 + x0] + data[y1 + x] + data[y1 + x2] +
          data[y2 + x0] + data[y2 + x] + data[y2 + x2]) / 9;
      const v = data[y1 + x] + amount * (data[y1 + x] - mean);
      out[y1 + x] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
    }
  }
  return { ...img, data: out };
}

/**
 * Auto-focus layer: per-curve-sample buccolingual offset that maximizes structure. For each
 * arch sample we probe candidate offsets and score the vertical high-frequency energy of a
 * thin column there (teeth/bone edges score high, homogeneous soft tissue low), then smooth
 * the winning offsets along the arch so the focal layer bends but stays a layer.
 */
export function autoFocusOffsets(
  entry: VolumeEntry,
  curve: ArchCurve,
  searchMm = 3,
  range?: ZRange,
): Float32Array {
  const [cols, rows, slices] = entry.meta.dims;
  const [sx, sy] = entry.meta.spacing;
  const scalar = entry.scalar;
  const sliceLen = cols * rows;
  const zLo = Math.max(0, range?.zLo ?? 0);
  const zHi = Math.min(slices - 1, range?.zHi ?? slices - 1);
  const zStride = 2;
  const candStep = 0.5;
  const raw = new Float32Array(curve.count);
  for (let i = 0; i < curve.count; i++) {
    const px = curve.pts[2 * i];
    const py = curve.pts[2 * i + 1];
    const nx = curve.normals[2 * i];
    const ny = curve.normals[2 * i + 1];
    let bestO = 0;
    let bestE = -1;
    for (let o = -searchMm; o <= searchMm + 1e-6; o += candStep) {
      const tap = makeTap(px + o * nx, py + o * ny, sx, sy, cols, rows);
      if (!tap) continue;
      let e = 0;
      let prev = 0;
      let first = true;
      for (let z = zLo; z <= zHi; z += zStride) {
        const base = z * sliceLen;
        const v =
          scalar[base + tap.i00] * tap.w00 +
          scalar[base + tap.i10] * tap.w10 +
          scalar[base + tap.i01] * tap.w01 +
          scalar[base + tap.i11] * tap.w11;
        if (!first) e += Math.abs(v - prev);
        prev = v;
        first = false;
      }
      if (e > bestE) {
        bestE = e;
        bestO = o;
      }
    }
    raw[i] = bestO;
  }
  // moving-average smoothing (~12 mm window) — the layer must bend smoothly, not jitter
  const win = Math.max(3, Math.round(12 / curve.step));
  const out = new Float32Array(curve.count);
  for (let i = 0; i < curve.count; i++) {
    let acc = 0;
    let k = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(curve.count - 1, i + win); j++) {
      acc += raw[j];
      k++;
    }
    out[i] = acc / k;
  }
  return out;
}

/**
 * Auto-fit arch: propose control points from the anatomy of one axial slice. Rays fan out
 * from the bone centroid toward the anterior half-plane; each ray keeps the midpoint of the
 * first substantial high-density run it crosses (a tooth / the alveolar process). Median
 * smoothing across neighboring rays kills outliers (fillings, spine). A PROPOSAL — the
 * reader drags dots after.
 */
export function autoFitArch(entry: VolumeEntry, zIndex: number): ArchPoint[] | null {
  const [cols, rows, slices] = entry.meta.dims;
  const [sx, sy] = entry.meta.spacing;
  const z = Math.max(0, Math.min(slices - 1, zIndex));
  const slice = entry.scalar.subarray(z * cols * rows, (z + 1) * cols * rows);
  const THRESH = 600; // enamel/dentine/cortical bone
  // bone centroid (stride-sampled)
  let cx = 0;
  let cy = 0;
  let n = 0;
  for (let y = 0; y < rows; y += 2) {
    for (let x = 0; x < cols; x += 2) {
      if (slice[y * cols + x] > THRESH) {
        cx += x;
        cy += y;
        n++;
      }
    }
  }
  if (n < 200) return null; // not a tooth-bearing slice
  cx /= n;
  cy /= n;
  const originX = cx;
  const originY = cy + 6 / sy; // start slightly posterior so anterior teeth are crossed once
  const stepMm = Math.max(sx, 0.2);
  const maxR = Math.hypot(cols * sx, rows * sy);
  const hits: (ArchPoint | null)[] = [];
  const ANG = 84; // fan ±84° around straight-anterior
  for (let a = -ANG; a <= ANG; a += 3) {
    const th = (a * Math.PI) / 180;
    const dx = Math.sin(th);
    const dy = -Math.cos(th); // anterior = −y
    let runStart = -1;
    let hit: ArchPoint | null = null;
    for (let r = 4; r < maxR; r += stepMm) {
      const xMm = originX * sx + dx * r;
      const yMm = originY * sy + dy * r;
      const xi = Math.round(xMm / sx);
      const yi = Math.round(yMm / sy);
      if (xi < 1 || yi < 1 || xi >= cols - 1 || yi >= rows - 1) break;
      const dense = slice[yi * cols + xi] > THRESH;
      if (dense && runStart < 0) runStart = r;
      if (!dense && runStart >= 0) {
        if (r - runStart >= 1.5) {
          const mid = (runStart + r) / 2;
          hit = { x: originX * sx + dx * mid, y: originY * sy + dy * mid };
          break;
        }
        runStart = -1; // too thin — noise
      }
    }
    hits.push(hit);
  }
  const good = hits.filter(Boolean) as ArchPoint[];
  if (good.length < 12) return null;
  // median-filter radii across neighboring rays (outlier kill), then downsample to ~9 dots
  const rad = hits.map((h) =>
    h ? Math.hypot(h.x - originX * sx, h.y - originY * sy) : NaN,
  );
  const smoothed: ArchPoint[] = [];
  for (let i = 0; i < hits.length; i++) {
    if (!hits[i]) continue;
    const windowR: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(hits.length - 1, i + 2); j++) {
      if (!Number.isNaN(rad[j])) windowR.push(rad[j]);
    }
    windowR.sort((a, b) => a - b);
    const med = windowR[Math.floor(windowR.length / 2)];
    const a = (-ANG + i * 3) * (Math.PI / 180);
    smoothed.push({
      x: originX * sx + Math.sin(a) * med,
      y: originY * sy - Math.cos(a) * med,
    });
  }
  const k = 9;
  const outPts: ArchPoint[] = [];
  for (let i = 0; i < k; i++) {
    outPts.push(smoothed[Math.round((i / (k - 1)) * (smoothed.length - 1))]);
  }
  return outPts;
}

/** Extract one axial slice (for the arch editor) as a drawable image. */
export function axialSlice(entry: VolumeEntry, zIndex: number): ReformatImage {
  const [cols, rows, slices] = entry.meta.dims;
  const z = Math.max(0, Math.min(slices - 1, zIndex));
  const sliceLen = cols * rows;
  return {
    data: entry.scalar.subarray(z * sliceLen, (z + 1) * sliceLen) as Int16Array,
    width: cols,
    height: rows,
    pxW: entry.meta.spacing[0],
    pxH: entry.meta.spacing[1],
  };
}
