'use client';
// Volume stitching math: rigid registration + fusion of two same-subject CBCT volumes into
// one. The one genuinely research-grade item in the feature
// spec. Everything is done in WORLD mm (each volume's origin + voxel·spacing), so volumes with
// different grids/origins align correctly.
//
// Transform convention: volume B is placed into A's world by a rigid motion about B's center:
//   pA = R·(pB − cB) + cB + t          (t = translation mm, R = euler rotation, cB = B center)
// To read B's content at an A-world point q we invert it:  pB = Rᵀ·(q − cB − t) + cB.
// Auto-registration is an NCC (normalized cross-correlation) hill-climb on a coarse lattice —
// coarse because CBCT voxels are fine and same-patient overlap is large; it converges fast and
// never touches the full volume in the inner loop.
import type { VolumeEntry, CbctMeta } from './volumeData';

export type Vec3 = [number, number, number];

export interface Rigid {
  t: Vec3; // translation mm (B in A's frame)
  r: Vec3; // euler rotation deg about B's center (x, y, z)
}

export const IDENTITY: Rigid = { t: [0, 0, 0], r: [0, 0, 0] };

/** World mm of voxel (i,j,k) — axis-aligned LPS grid: origin + index·spacing. */
export function worldOfVoxel(meta: CbctMeta, i: number, j: number, k: number): Vec3 {
  const [ox, oy, oz] = meta.origin;
  const [sx, sy, sz] = meta.spacing;
  return [ox + i * sx, oy + j * sy, oz + k * sz];
}

export function volCenterWorld(meta: CbctMeta): Vec3 {
  const [nx, ny, nz] = meta.dims;
  return worldOfVoxel(meta, (nx - 1) / 2, (ny - 1) / 2, (nz - 1) / 2);
}

/** Row-major 3×3 euler rotation (Rz·Ry·Rx), degrees. */
export function eulerMat(rx: number, ry: number, rz: number): number[] {
  const dr = Math.PI / 180;
  const cx = Math.cos(rx * dr), sxn = Math.sin(rx * dr);
  const cy = Math.cos(ry * dr), syn = Math.sin(ry * dr);
  const cz = Math.cos(rz * dr), szn = Math.sin(rz * dr);
  // Rz * Ry * Rx
  return [
    cz * cy, cz * syn * sxn - szn * cx, cz * syn * cx + szn * sxn,
    szn * cy, szn * syn * sxn + cz * cx, szn * syn * cx - cz * sxn,
    -syn, cy * sxn, cy * cx,
  ];
}

function matT(m: number[]): number[] {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
function apply(m: number[], v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Nearest-voxel HU sample of a volume at a WORLD point, or null if outside. */
export function sampleWorld(entry: VolumeEntry, wx: number, wy: number, wz: number): number | null {
  const { dims, spacing, origin } = entry.meta;
  const i = Math.round((wx - origin[0]) / spacing[0]);
  const j = Math.round((wy - origin[1]) / spacing[1]);
  const k = Math.round((wz - origin[2]) / spacing[2]);
  if (i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2]) return null;
  return entry.scalar[k * dims[1] * dims[0] + j * dims[0] + i];
}

/** Inverse transform: given an A-world query point, the B-world point whose content lands there. */
export function aWorldToB(q: Vec3, cB: Vec3, rigid: Rigid): Vec3 {
  const Rt = matT(eulerMat(rigid.r[0], rigid.r[1], rigid.r[2]));
  const d: Vec3 = [q[0] - cB[0] - rigid.t[0], q[1] - cB[1] - rigid.t[1], q[2] - cB[2] - rigid.t[2]];
  const p = apply(Rt, d);
  return [p[0] + cB[0], p[1] + cB[1], p[2] + cB[2]];
}

/** A coarse lattice of (A-world point, A HU) over A's bone-bearing voxels — the NCC fixed set. */
interface Lattice {
  pts: Float32Array; // [x,y,z, ...]
  vals: Float32Array;
  n: number;
}
function buildLattice(A: VolumeEntry, stride: number): Lattice {
  const [nx, ny, nz] = A.meta.dims;
  const pts: number[] = [];
  const vals: number[] = [];
  for (let k = 0; k < nz; k += stride)
    for (let j = 0; j < ny; j += stride)
      for (let i = 0; i < nx; i += stride) {
        const v = A.scalar[k * ny * nx + j * nx + i];
        if (v < -500) continue; // skip air — it carries no registration signal
        const w = worldOfVoxel(A.meta, i, j, k);
        pts.push(w[0], w[1], w[2]);
        vals.push(v);
      }
  return { pts: new Float32Array(pts), vals: new Float32Array(vals), n: vals.length };
}

/** NCC of A's lattice values vs B resampled at the (inverse-transformed) same points. */
function ncc(lat: Lattice, B: VolumeEntry, cB: Vec3, rigid: Rigid): number {
  const Rt = matT(eulerMat(rigid.r[0], rigid.r[1], rigid.r[2]));
  const { origin, spacing, dims } = B.meta;
  const [nx, ny, nz] = dims;
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  for (let idx = 0; idx < lat.n; idx++) {
    const qx = lat.pts[3 * idx] - cB[0] - rigid.t[0];
    const qy = lat.pts[3 * idx + 1] - cB[1] - rigid.t[1];
    const qz = lat.pts[3 * idx + 2] - cB[2] - rigid.t[2];
    const bx = Rt[0] * qx + Rt[1] * qy + Rt[2] * qz + cB[0];
    const by = Rt[3] * qx + Rt[4] * qy + Rt[5] * qz + cB[1];
    const bz = Rt[6] * qx + Rt[7] * qy + Rt[8] * qz + cB[2];
    const i = Math.round((bx - origin[0]) / spacing[0]);
    const j = Math.round((by - origin[1]) / spacing[1]);
    const k = Math.round((bz - origin[2]) / spacing[2]);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
    const b = B.scalar[k * ny * nx + j * nx + i];
    if (b < -500) continue;
    const a = lat.vals[idx];
    sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; n++;
  }
  if (n < 200) return -2; // too little overlap to trust
  const ma = sa / n, mb = sb / n;
  const cov = sab / n - ma * mb;
  const va = saa / n - ma * ma;
  const vb = sbb / n - mb * mb;
  const denom = Math.sqrt(Math.max(1e-6, va * vb));
  return cov / denom;
}

export interface RegProgress {
  (frac: number, best: number): void;
}

/**
 * Rigid registration by coordinate-descent hill-climb on NCC. Translation always; rotation too
 * when withRotation. Multi-resolution in step size (coarse → fine mm), a fixed iteration budget.
 */
export function autoRegister(
  A: VolumeEntry,
  B: VolumeEntry,
  withRotation: boolean,
  start: Rigid = IDENTITY,
  onProgress?: RegProgress,
): Rigid {
  const cB = volCenterWorld(B.meta);
  const stride = Math.max(3, Math.round(Math.max(A.meta.dims[0], A.meta.dims[2]) / 40));
  const lat = buildLattice(A, stride);
  let best: Rigid = { t: [...start.t] as Vec3, r: [...start.r] as Vec3 };
  let bestScore = ncc(lat, B, cB, best);
  const tSteps = [8, 4, 2, 1]; // mm
  const rSteps = [4, 2, 1]; // deg
  let iter = 0;
  const total = tSteps.length * 6 * 3 + (withRotation ? rSteps.length * 6 * 3 : 0);
  const tryMove = (dim: 0 | 1 | 2, kind: 't' | 'r', delta: number): boolean => {
    const cand: Rigid = { t: [...best.t] as Vec3, r: [...best.r] as Vec3 };
    cand[kind][dim] += delta;
    const sc = ncc(lat, B, cB, cand);
    iter++;
    onProgress?.(Math.min(1, iter / total), bestScore);
    if (sc > bestScore) {
      bestScore = sc;
      best = cand;
      return true;
    }
    return false;
  };
  for (const step of tSteps) {
    for (let pass = 0; pass < 3; pass++) {
      let improved = false;
      for (let d = 0 as 0 | 1 | 2; d <= 2; d = (d + 1) as 0 | 1 | 2) {
        if (tryMove(d, 't', step)) improved = true;
        else if (tryMove(d, 't', -step)) improved = true;
      }
      if (!improved) break;
    }
  }
  if (withRotation) {
    for (const step of rSteps) {
      for (let pass = 0; pass < 3; pass++) {
        let improved = false;
        for (let d = 0 as 0 | 1 | 2; d <= 2; d = (d + 1) as 0 | 1 | 2) {
          if (tryMove(d, 'r', step)) improved = true;
          else if (tryMove(d, 'r', -step)) improved = true;
        }
        if (!improved) break;
      }
      // one translation refine between rotation scales
      for (let d = 0 as 0 | 1 | 2; d <= 2; d = (d + 1) as 0 | 1 | 2) {
        if (!tryMove(d, 't', 1)) tryMove(d, 't', -1);
      }
    }
  }
  onProgress?.(1, bestScore);
  return best;
}

export function nccScore(A: VolumeEntry, B: VolumeEntry, rigid: Rigid): number {
  const cB = volCenterWorld(B.meta);
  const stride = Math.max(3, Math.round(Math.max(A.meta.dims[0], A.meta.dims[2]) / 40));
  return ncc(buildLattice(A, stride), B, cB, rigid);
}

export interface BakedFusion {
  dims: Vec3;
  spacing: Vec3;
  origin: Vec3;
  data: Int16Array;
  defaultVoi: { center: number; width: number };
}

const BAKE_MAX_VOX = 160_000_000; // ≈ 320 MB Int16 — hard ceiling; output spacing coarsens to fit

/**
 * Resample A and B onto ONE grid over their union bounding box (A's voxel pitch, coarsened only
 * if the union would blow the voxel cap). Where both volumes cover a voxel, average; otherwise
 * take whichever exists. AIR (−1000) from one side never dilutes real signal from the other.
 */
export function bakeFusion(A: VolumeEntry, B: VolumeEntry, rigid: Rigid): BakedFusion {
  const cB = volCenterWorld(B.meta);
  // union bbox in A-world: A's 8 corners are axis-aligned already; B's 8 corners transform in
  const corners: Vec3[] = [];
  const [anx, any_, anz] = A.meta.dims;
  for (const [i, j, k] of [
    [0, 0, 0], [anx - 1, 0, 0], [0, any_ - 1, 0], [0, 0, anz - 1],
    [anx - 1, any_ - 1, 0], [anx - 1, 0, anz - 1], [0, any_ - 1, anz - 1], [anx - 1, any_ - 1, anz - 1],
  ] as Vec3[]) {
    corners.push(worldOfVoxel(A.meta, i, j, k));
  }
  const Rf = eulerMat(rigid.r[0], rigid.r[1], rigid.r[2]);
  const [bnx, bny, bnz] = B.meta.dims;
  for (const [i, j, k] of [
    [0, 0, 0], [bnx - 1, 0, 0], [0, bny - 1, 0], [0, 0, bnz - 1],
    [bnx - 1, bny - 1, 0], [bnx - 1, 0, bnz - 1], [0, bny - 1, bnz - 1], [bnx - 1, bny - 1, bnz - 1],
  ] as Vec3[]) {
    const pB = worldOfVoxel(B.meta, i, j, k);
    const d: Vec3 = [pB[0] - cB[0], pB[1] - cB[1], pB[2] - cB[2]];
    const rp = apply(Rf, d);
    corners.push([rp[0] + cB[0] + rigid.t[0], rp[1] + cB[1] + rigid.t[1], rp[2] + cB[2] + rigid.t[2]]);
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of corners) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  let sp: Vec3 = [...A.meta.spacing] as Vec3;
  let dims: Vec3 = [
    Math.ceil((maxX - minX) / sp[0]) + 1,
    Math.ceil((maxY - minY) / sp[1]) + 1,
    Math.ceil((maxZ - minZ) / sp[2]) + 1,
  ];
  // coarsen isotropically until under the voxel cap
  while (dims[0] * dims[1] * dims[2] > BAKE_MAX_VOX) {
    sp = [sp[0] * 1.4, sp[1] * 1.4, sp[2] * 1.4];
    dims = [
      Math.ceil((maxX - minX) / sp[0]) + 1,
      Math.ceil((maxY - minY) / sp[1]) + 1,
      Math.ceil((maxZ - minZ) / sp[2]) + 1,
    ];
  }
  const origin: Vec3 = [minX, minY, minZ];
  const [nx, ny, nz] = dims;
  const data = new Int16Array(nx * ny * nz);
  const Rt = matT(Rf);
  for (let k = 0; k < nz; k++) {
    const wz = minZ + k * sp[2];
    for (let j = 0; j < ny; j++) {
      const wy = minY + j * sp[1];
      const rowOff = (k * ny + j) * nx;
      for (let i = 0; i < nx; i++) {
        const wx = minX + i * sp[0];
        const a = sampleWorld(A, wx, wy, wz);
        // B at this A-world point
        const dx = wx - cB[0] - rigid.t[0];
        const dy = wy - cB[1] - rigid.t[1];
        const dz = wz - cB[2] - rigid.t[2];
        const bx = Rt[0] * dx + Rt[1] * dy + Rt[2] * dz + cB[0];
        const by = Rt[3] * dx + Rt[4] * dy + Rt[5] * dz + cB[1];
        const bz = Rt[6] * dx + Rt[7] * dy + Rt[8] * dz + cB[2];
        const b = sampleWorld(B, bx, by, bz);
        let v: number;
        if (a !== null && b !== null) v = (a + b) / 2;
        else if (a !== null) v = a;
        else if (b !== null) v = b;
        else v = -1000;
        data[rowOff + i] = v;
      }
    }
  }
  return { dims, spacing: sp, origin, data, defaultVoi: A.meta.defaultVoi };
}
