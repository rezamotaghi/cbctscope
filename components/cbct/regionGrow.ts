'use client';
// Region growing: from a seed voxel, flood-fill every
// 6-connected voxel whose HU falls in [loHU, hiHU], constrained to a reader-drawn bounding
// box (so "grow air" can't escape into the whole scanner FOV). Returns a BOX-LOCAL mask —
// allocating a full 500³ mask per grow would be 125 MB; the box is almost always a fraction
// of that. Reports volume, HU stats, and a per-z cross-sectional area profile (the airway
// read). Iterative stack, hard voxel cap — never lock the tab on a runaway air fill.
import type { VolumeEntry } from './volumeData';

export interface GrowBox {
  x0: number; x1: number; // inclusive voxel bounds
  y0: number; y1: number;
  z0: number; z1: number;
}

export interface GrowResult {
  box: GrowBox;
  /** box-local mask, index = (z-z0)*bw*bh + (y-y0)*bw + (x-x0) */
  mask: Uint8Array;
  bw: number; bh: number; bd: number;
  voxelCount: number;
  volumeCm3: number;
  meanHU: number;
  sdHU: number;
  minHU: number;
  maxHU: number;
  /** mm² of masked area per GLOBAL z index (length = dims z); 0 where the mask is absent */
  areaByZ: Float32Array;
  /** z index (global) of the smallest non-empty masked slice — the airway pinch point */
  narrowestZ: number;
  narrowestAreaMm2: number;
  capped: boolean;
}

export const HU_PRESETS: Record<string, { lo: number; hi: number; label: string }> = {
  air: { lo: -1024, hi: -400, label: 'air / airway' },
  soft: { lo: -200, hi: 300, label: 'soft tissue' },
  bone: { lo: 400, hi: 3000, label: 'bone' }, // hi clamped to the HU sliders' max — 3200 put the thumb out of range
  root: { lo: 900, hi: 2600, label: 'tooth / root' },
};

const MAX_VOX = 4_000_000;

function clampBox(box: GrowBox, dims: [number, number, number]): GrowBox {
  const [nx, ny, nz] = dims;
  return {
    x0: Math.max(0, Math.min(nx - 1, Math.round(box.x0))),
    x1: Math.max(0, Math.min(nx - 1, Math.round(box.x1))),
    y0: Math.max(0, Math.min(ny - 1, Math.round(box.y0))),
    y1: Math.max(0, Math.min(ny - 1, Math.round(box.y1))),
    z0: Math.max(0, Math.min(nz - 1, Math.round(box.z0))),
    z1: Math.max(0, Math.min(nz - 1, Math.round(box.z1))),
  };
}

/** One 6-connected dilate then erode inside the box (morphological closing — fills pinholes). */
function close(mask: Uint8Array, bw: number, bh: number, bd: number): Uint8Array {
  const dil = new Uint8Array(mask.length);
  const idx = (x: number, y: number, z: number) => z * bw * bh + y * bw + x;
  const pass = (src: Uint8Array, dst: Uint8Array, want: number, set: number, clear: number) => {
    for (let z = 0; z < bd; z++)
      for (let y = 0; y < bh; y++)
        for (let x = 0; x < bw; x++) {
          const i = idx(x, y, z);
          if (src[i] === want) {
            dst[i] = src[i];
            continue;
          }
          let hit = false;
          if (x > 0 && src[i - 1] === want) hit = true;
          else if (x < bw - 1 && src[i + 1] === want) hit = true;
          else if (y > 0 && src[i - bw] === want) hit = true;
          else if (y < bh - 1 && src[i + bw] === want) hit = true;
          else if (z > 0 && src[i - bw * bh] === want) hit = true;
          else if (z < bd - 1 && src[i + bw * bh] === want) hit = true;
          dst[i] = hit ? set : clear;
        }
  };
  pass(mask, dil, 1, 1, 0); // dilate: any 6-neighbor set → set
  const ero = new Uint8Array(dil.length);
  // erode: a set voxel with any unset 6-neighbor → clear
  for (let z = 0; z < bd; z++)
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const i = idx(x, y, z);
        if (dil[i] !== 1) {
          ero[i] = 0;
          continue;
        }
        let edge = false;
        if (x > 0 && dil[i - 1] === 0) edge = true;
        else if (x < bw - 1 && dil[i + 1] === 0) edge = true;
        else if (y > 0 && dil[i - bw] === 0) edge = true;
        else if (y < bh - 1 && dil[i + bw] === 0) edge = true;
        else if (z > 0 && dil[i - bw * bh] === 0) edge = true;
        else if (z < bd - 1 && dil[i + bw * bh] === 0) edge = true;
        ero[i] = edge ? 0 : 1;
      }
  return ero;
}

export function growRegion(
  entry: VolumeEntry,
  seed: [number, number, number],
  loHU: number,
  hiHU: number,
  boxIn: GrowBox,
  smooth: boolean,
): GrowResult | null {
  const dims = entry.meta.dims;
  const [nx, ny, nz] = dims;
  const s = entry.scalar;
  const box = clampBox(boxIn, dims);
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const bd = box.z1 - box.z0 + 1;
  if (bw < 1 || bh < 1 || bd < 1) return null;
  const [sxv, syv, szv] = seed.map(Math.round) as [number, number, number];
  if (sxv < box.x0 || sxv > box.x1 || syv < box.y0 || syv > box.y1 || szv < box.z0 || szv > box.z1) return null;
  const seedVal = s[szv * ny * nx + syv * nx + sxv];
  if (seedVal < loHU || seedVal > hiHU) return null; // seed itself must be in range

  const rawMask = new Uint8Array(bw * bh * bd);
  const local = (x: number, y: number, z: number) => (z - box.z0) * bw * bh + (y - box.y0) * bw + (x - box.x0);
  const global = (x: number, y: number, z: number) => z * ny * nx + y * nx + x;
  const stack = new Int32Array(Math.min(MAX_VOX, bw * bh * bd));
  let sp = 0;
  const startL = local(sxv, syv, szv);
  rawMask[startL] = 1;
  stack[sp++] = startL;
  let count = 0;
  let capped = false;
  // walk the box-local stack of linear indices
  while (sp > 0) {
    const li = stack[--sp];
    count++;
    if (count > MAX_VOX) {
      capped = true;
      break;
    }
    const lz = Math.floor(li / (bw * bh));
    const rem = li - lz * bw * bh;
    const ly = Math.floor(rem / bw);
    const lx = rem - ly * bw;
    const gx = lx + box.x0;
    const gy = ly + box.y0;
    const gz = lz + box.z0;
    // 6 neighbors
    const tryN = (nxg: number, nyg: number, nzg: number, nl: number) => {
      if (rawMask[nl]) return;
      const v = s[global(nxg, nyg, nzg)];
      if (v < loHU || v > hiHU) return;
      rawMask[nl] = 1;
      if (sp < stack.length) stack[sp++] = nl;
    };
    if (gx > box.x0) tryN(gx - 1, gy, gz, li - 1);
    if (gx < box.x1) tryN(gx + 1, gy, gz, li + 1);
    if (gy > box.y0) tryN(gx, gy - 1, gz, li - bw);
    if (gy < box.y1) tryN(gx, gy + 1, gz, li + bw);
    if (gz > box.z0) tryN(gx, gy, gz - 1, li - bw * bh);
    if (gz < box.z1) tryN(gx, gy, gz + 1, li + bw * bh);
  }

  const mask = smooth ? close(rawMask, bw, bh, bd) : rawMask;

  // stats + per-z area
  const voxelVolMm3 = entry.meta.spacing[0] * entry.meta.spacing[1] * entry.meta.spacing[2];
  const voxelAreaMm2 = entry.meta.spacing[0] * entry.meta.spacing[1];
  const areaByZ = new Float32Array(nz);
  let vc = 0;
  let sum = 0;
  let sumSq = 0;
  let mn = Infinity;
  let mx = -Infinity;
  for (let lz = 0; lz < bd; lz++) {
    let zc = 0;
    for (let ly = 0; ly < bh; ly++)
      for (let lx = 0; lx < bw; lx++) {
        if (mask[lz * bw * bh + ly * bw + lx]) {
          zc++;
          const v = s[global(lx + box.x0, ly + box.y0, lz + box.z0)];
          sum += v;
          sumSq += v * v;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
    vc += zc;
    areaByZ[lz + box.z0] = zc * voxelAreaMm2;
  }
  if (vc === 0) return null;
  const mean = sum / vc;
  const variance = Math.max(0, sumSq / vc - mean * mean);
  // narrowest non-empty slice
  let narrowestZ = -1;
  let narrowestArea = Infinity;
  for (let z = box.z0; z <= box.z1; z++) {
    const a = areaByZ[z];
    if (a > 0 && a < narrowestArea) {
      narrowestArea = a;
      narrowestZ = z;
    }
  }
  return {
    box,
    mask,
    bw,
    bh,
    bd,
    voxelCount: vc,
    volumeCm3: (vc * voxelVolMm3) / 1000,
    meanHU: mean,
    sdHU: Math.sqrt(variance),
    minHU: mn,
    maxHU: mx,
    areaByZ,
    narrowestZ,
    narrowestAreaMm2: narrowestArea === Infinity ? 0 : narrowestArea,
    capped,
  };
}
