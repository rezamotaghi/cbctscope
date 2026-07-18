'use client';
// Generic oblique-plane sampling shared by the reading modules (and the Grid view, where it
// was born). A "basis" is three perpendicular unit vectors in voxel space: u = image columns,
// v = image rows, n = the stack normal (planes advance along it). renderOblique resamples one
// such plane (with an averaging or MIP slab) straight out of the Int16 HU buffer — nearest-
// neighbor, incremental stepping, no trig in the hot loop — fast enough to redraw a whole
// grid interactively on isotropic fine-pitch CBCT voxels.
import type { VolumeEntry } from './volumeData';

export type V3 = [number, number, number];

export interface Basis {
  u: V3; // in-plane columns direction (voxel space)
  v: V3; // in-plane rows direction
  n: V3; // stack normal (slices advance along this)
}

/** Rodrigues rotation of v around unit axis by deg. */
export function rotV(v: V3, axis: V3, deg: number): V3 {
  const th = (deg * Math.PI) / 180;
  const [x, y, z] = v;
  const [ux, uy, uz] = axis;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const d = (1 - c) * (ux * x + uy * y + uz * z);
  return [
    x * c + (uy * z - uz * y) * sn + ux * d,
    y * c + (uz * x - ux * z) * sn + uy * d,
    z * c + (ux * y - uy * x) * sn + uz * d,
  ];
}

/** Extent (in voxels) of the volume projected on a direction. */
export function extentAlong(dir: V3, dims: [number, number, number]): number {
  return Math.abs(dir[0]) * dims[0] + Math.abs(dir[1]) * dims[1] + Math.abs(dir[2]) * dims[2];
}

/**
 * Resample one oblique plane (with slab avg/MIP) into a windowed ImageData.
 * Plane: p(c,r) = C + u·(c-w/2) + v·(r-h/2) + n·(off + a), a over the slab. Nearest-neighbor
 * sampling — voxels are isotropic and fine-pitch, and it keeps a full grid redraw interactive.
 * `stride` renders every stride-th output pixel AND slab tap (a stride² × stride speedup) into
 * a proportionally smaller image — the fast-preview path while a slider is dragging.
 */
export function renderOblique(
  entry: VolumeEntry,
  basis: Basis,
  off: number,
  slabVox: number,
  mip: boolean,
  lower: number,
  upper: number,
  invert: boolean,
  gamma: number,
  stride = 1,
): ImageData {
  const { dims } = entry.meta;
  const [nx, ny, nz] = dims;
  const s = entry.scalar;
  const { u, v, n } = basis;
  const fullW = Math.max(2, Math.round(extentAlong(u, dims)));
  const fullH = Math.max(2, Math.round(extentAlong(v, dims)));
  const w = Math.max(2, Math.floor(fullW / stride));
  const h = Math.max(2, Math.floor(fullH / stride));
  const img = new ImageData(w, h);
  const px = img.data;
  const C: V3 = [nx / 2, ny / 2, nz / 2];
  const range = Math.max(1, upper - lower);
  const invGamma = 1 / Math.max(0.05, gamma);
  const half = Math.floor(slabVox / 2);
  const acc = new Float32Array(w);
  const hits = new Int32Array(w);
  const uX = u[0] * stride;
  const uY = u[1] * stride;
  const uZ = u[2] * stride;
  for (let r = 0; r < h; r++) {
    acc.fill(mip ? -32768 : 0);
    hits.fill(0);
    for (let a = -half; a <= half; a += stride) {
      // walk the row incrementally: p starts at column 0 and advances by u per column
      let pX = C[0] + u[0] * -((w / 2) * stride) + v[0] * (r - h / 2) * stride + n[0] * (off + a);
      let pY = C[1] + u[1] * -((w / 2) * stride) + v[1] * (r - h / 2) * stride + n[1] * (off + a);
      let pZ = C[2] + u[2] * -((w / 2) * stride) + v[2] * (r - h / 2) * stride + n[2] * (off + a);
      for (let c = 0; c < w; c++) {
        const xi = Math.round(pX);
        const yi = Math.round(pY);
        const zi = Math.round(pZ);
        if (xi >= 0 && yi >= 0 && zi >= 0 && xi < nx && yi < ny && zi < nz) {
          const val = s[zi * ny * nx + yi * nx + xi];
          if (mip) {
            if (val > acc[c]) acc[c] = val;
          } else acc[c] += val;
          hits[c]++;
        }
        pX += uX;
        pY += uY;
        pZ += uZ;
      }
    }
    const rowOff = r * w * 4;
    for (let c = 0; c < w; c++) {
      let g8 = 0;
      if (hits[c] > 0) {
        const val = mip ? acc[c] : acc[c] / hits[c];
        let t = (val - lower) / range;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (gamma !== 1) t = Math.pow(t, invGamma);
        if (invert) t = 1 - t;
        g8 = Math.round(t * 255);
      }
      const o = rowOff + c * 4;
      px[o] = g8;
      px[o + 1] = g8;
      px[o + 2] = g8;
      px[o + 3] = 255;
    }
  }
  return img;
}

/**
 * Full-depth HU projection along the basis normal (avg = film-like, or MIP), strided.
 * Returns raw HU (Float32) — the auto-window pass reads this to pick display percentiles.
 * Same walk as renderOblique but integrates the WHOLE volume depth and skips windowing.
 */
export function projectHU(
  entry: VolumeEntry,
  basis: Basis,
  mip: boolean,
  stride: number,
): { data: Float32Array; w: number; h: number } {
  const { dims } = entry.meta;
  const [nx, ny, nz] = dims;
  const s = entry.scalar;
  const { u, v, n } = basis;
  const depth = Math.round(extentAlong(n, dims));
  const half = Math.floor(depth / 2);
  const fullW = Math.max(2, Math.round(extentAlong(u, dims)));
  const fullH = Math.max(2, Math.round(extentAlong(v, dims)));
  const w = Math.max(2, Math.floor(fullW / stride));
  const h = Math.max(2, Math.floor(fullH / stride));
  const out = new Float32Array(w * h);
  const C: [number, number, number] = [nx / 2, ny / 2, nz / 2];
  const acc = new Float32Array(w);
  const hits = new Int32Array(w);
  const uX = u[0] * stride;
  const uY = u[1] * stride;
  const uZ = u[2] * stride;
  for (let r = 0; r < h; r++) {
    acc.fill(mip ? -32768 : 0);
    hits.fill(0);
    for (let a = -half; a <= half; a += stride) {
      let pX = C[0] + u[0] * -((w / 2) * stride) + v[0] * (r - h / 2) * stride + n[0] * a;
      let pY = C[1] + u[1] * -((w / 2) * stride) + v[1] * (r - h / 2) * stride + n[1] * a;
      let pZ = C[2] + u[2] * -((w / 2) * stride) + v[2] * (r - h / 2) * stride + n[2] * a;
      for (let c = 0; c < w; c++) {
        const xi = Math.round(pX);
        const yi = Math.round(pY);
        const zi = Math.round(pZ);
        if (xi >= 0 && yi >= 0 && zi >= 0 && xi < nx && yi < ny && zi < nz) {
          const val = s[zi * ny * nx + yi * nx + xi];
          if (mip) {
            if (val > acc[c]) acc[c] = val;
          } else acc[c] += val;
          hits[c]++;
        }
        pX += uX;
        pY += uY;
        pZ += uZ;
      }
    }
    const rowOff = r * w;
    for (let c = 0; c < w; c++) out[rowOff + c] = hits[c] > 0 ? (mip ? acc[c] : acc[c] / hits[c]) : -1000;
  }
  return { data: out, w, h };
}

/** Map a click on an object-fit:contain canvas back into canvas pixel coords. */
export function canvasPoint(
  cv: HTMLCanvasElement,
  e: { clientX: number; clientY: number },
): [number, number] | null {
  const rect = cv.getBoundingClientRect();
  if (!cv.width || !cv.height || !rect.width || !rect.height) return null;
  const scale = Math.min(rect.width / cv.width, rect.height / cv.height);
  const offX = (rect.width - cv.width * scale) / 2;
  const offY = (rect.height - cv.height * scale) / 2;
  const x = (e.clientX - rect.left - offX) / scale;
  const y = (e.clientY - rect.top - offY) / scale;
  if (x < 0 || y < 0 || x > cv.width || y > cv.height) return null;
  return [x, y];
}
