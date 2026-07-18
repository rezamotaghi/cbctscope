// Clean-rendering eraser: paint on the 3D render to
// carve away artefacts/anatomy, with per-stroke undo/redo and full revert.
//
// SAFETY: the eraser NEVER edits the buffer the MPR slices read. The viewer gives the 3D
// pane its own COPY of the voxels before the first erase (see CbctViewport); this class
// only ever writes through that copy-volume's voxel accessors. Revert = throw the copy away.
//
// Erase model: each pointer sample casts a ray from the camera through the cursor into the
// volume, finds the first voxel dense enough to be VISIBLE at the current render threshold,
// and blanks a sphere of the chosen radius there to air (−1000 HU) — "erase what you touch".
// A stroke (down→up) is one undo unit. Methods return the touched z-slice range so the
// caller can re-upload only those frames to the GPU (Cornerstone streams the volume texture
// per frame).

export const AIR_HU = -1000;

/** Read/write access to the erase copy's voxels (Cornerstone VoxelManager accessors). */
export interface VoxelAccess {
  get: (index: number) => number;
  set: (index: number, v: number) => void;
}

interface EraseStroke {
  indices: Uint32Array; // flat voxel indices touched by the stroke
  oldValues: Float32Array; // their pre-stroke HU (redo just re-blanks to AIR_HU)
  zMin: number;
  zMax: number;
}

export interface EraserGeometry {
  dims: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
}

export type ZRange = [number, number];

export class Eraser3d {
  private vox: VoxelAccess;
  private geo: EraserGeometry;
  private undoStack: EraseStroke[] = [];
  private redoStack: EraseStroke[] = [];
  private curIdx: number[] = [];
  private curVal: number[] = [];
  private curZMin = Infinity;
  private curZMax = -Infinity;
  private touched = new Set<number>();
  private inStroke = false;

  constructor(vox: VoxelAccess, geo: EraserGeometry) {
    this.vox = vox;
    this.geo = geo;
  }

  beginStroke() {
    this.inStroke = true;
    this.touched.clear();
    this.curIdx = [];
    this.curVal = [];
    this.curZMin = Infinity;
    this.curZMax = -Infinity;
  }

  /** One brush sample. Returns the changed z-slice range (for a partial GPU upload) or null. */
  eraseAt(rayPoint: number[], rayDir: number[], visibleHu: number, radiusMm: number): ZRange | null {
    if (!this.inStroke) return null;
    const { dims, spacing, origin } = this.geo;
    // clip the ray against the volume box (slab method) so the march starts/ends on it
    let t0 = -Infinity;
    let t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      const lo = origin[a];
      const hi = origin[a] + (dims[a] - 1) * spacing[a];
      if (Math.abs(rayDir[a]) < 1e-9) {
        if (rayPoint[a] < lo || rayPoint[a] > hi) return null;
        continue;
      }
      const ta = (lo - rayPoint[a]) / rayDir[a];
      const tb = (hi - rayPoint[a]) / rayDir[a];
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
    }
    if (t0 > t1) return null;
    const step = Math.min(spacing[0], spacing[1], spacing[2]) * 0.6;
    const [cols, rows, slices] = dims;
    for (let t = Math.max(t0, 0); t <= t1; t += step) {
      const wx = rayPoint[0] + rayDir[0] * t;
      const wy = rayPoint[1] + rayDir[1] * t;
      const wz = rayPoint[2] + rayDir[2] * t;
      const ci = Math.round((wx - origin[0]) / spacing[0]);
      const ri = Math.round((wy - origin[1]) / spacing[1]);
      const si = Math.round((wz - origin[2]) / spacing[2]);
      if (ci < 0 || ri < 0 || si < 0 || ci >= cols || ri >= rows || si >= slices) continue;
      if (this.vox.get(si * rows * cols + ri * cols + ci) >= visibleHu) {
        return this.eraseSphere([wx, wy, wz], radiusMm);
      }
    }
    return null;
  }

  private eraseSphere(center: number[], radiusMm: number): ZRange | null {
    const { dims, spacing, origin } = this.geo;
    const [cols, rows, slices] = dims;
    const c = [
      (center[0] - origin[0]) / spacing[0],
      (center[1] - origin[1]) / spacing[1],
      (center[2] - origin[2]) / spacing[2],
    ];
    const r = [radiusMm / spacing[0], radiusMm / spacing[1], radiusMm / spacing[2]];
    const z0 = Math.max(0, Math.ceil(c[2] - r[2]));
    const z1 = Math.min(slices - 1, Math.floor(c[2] + r[2]));
    const y0 = Math.max(0, Math.ceil(c[1] - r[1]));
    const y1 = Math.min(rows - 1, Math.floor(c[1] + r[1]));
    const x0 = Math.max(0, Math.ceil(c[0] - r[0]));
    const x1 = Math.min(cols - 1, Math.floor(c[0] + r[0]));
    let changed = false;
    for (let z = z0; z <= z1; z++) {
      const dz = (z - c[2]) / r[2];
      const dz2 = dz * dz;
      for (let y = y0; y <= y1; y++) {
        const dy = (y - c[1]) / r[1];
        const d2 = dz2 + dy * dy;
        if (d2 > 1) continue;
        const rowBase = z * rows * cols + y * cols;
        for (let x = x0; x <= x1; x++) {
          const dx = (x - c[0]) / r[0];
          if (d2 + dx * dx > 1) continue;
          const idx = rowBase + x;
          if (this.touched.has(idx)) continue;
          const v = this.vox.get(idx);
          if (v === AIR_HU) continue;
          this.touched.add(idx);
          this.curIdx.push(idx);
          this.curVal.push(v);
          this.vox.set(idx, AIR_HU);
          changed = true;
        }
      }
    }
    if (!changed) return null;
    this.curZMin = Math.min(this.curZMin, z0);
    this.curZMax = Math.max(this.curZMax, z1);
    return [z0, z1];
  }

  /** Close the stroke; returns true if it erased anything (then it's on the undo stack). */
  endStroke(): boolean {
    this.inStroke = false;
    if (!this.curIdx.length) return false;
    this.undoStack.push({
      indices: Uint32Array.from(this.curIdx),
      oldValues: Float32Array.from(this.curVal),
      zMin: this.curZMin,
      zMax: this.curZMax,
    });
    this.redoStack = [];
    this.curIdx = [];
    this.curVal = [];
    this.touched.clear();
    return true;
  }

  undo(): ZRange | null {
    const s = this.undoStack.pop();
    if (!s) return null;
    for (let i = 0; i < s.indices.length; i++) this.vox.set(s.indices[i], s.oldValues[i]);
    this.redoStack.push(s);
    return [s.zMin, s.zMax];
  }

  redo(): ZRange | null {
    const s = this.redoStack.pop();
    if (!s) return null;
    for (let i = 0; i < s.indices.length; i++) this.vox.set(s.indices[i], AIR_HU);
    this.undoStack.push(s);
    return [s.zMin, s.zMax];
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }
  strokeCount() {
    return this.undoStack.length;
  }
}
