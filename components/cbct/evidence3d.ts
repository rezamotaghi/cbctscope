// 3D box ROI: drag a rectangle on a slice,
// give it a depth, and the enclosed BOX of voxels is characterized — volume, edge lengths,
// and the density statistics (mean / SD / min–max HU) a lesion write-up needs.
//
// The box is ORIENTED, not axis-aligned: its axes come from the camera of the pane it was
// drawn on (in-plane right, in-plane down, view normal), so it stays correct on rotated /
// oblique sections. Stats walk the voxel buffer directly (the same Int16 HU array the panes
// render from) — membership test = three dot products against the box axes.

export interface Roi3dStats {
  nVoxels: number;
  meanHu: number;
  sdHu: number;
  minHu: number;
  maxHu: number;
  volumeCm3: number;
}

export interface Roi3d {
  id: string;
  /** world-mm center of the box */
  center: [number, number, number];
  /** orthonormal box axes (rows): in-plane right, in-plane down, view normal */
  axes: [number[], number[], number[]];
  /** half-extent in mm along each axis */
  half: [number, number, number];
  stats: Roi3dStats;
  visible: boolean;
}

export interface VolumeGeometry {
  dims: [number, number, number]; // cols, rows, slices
  spacing: [number, number, number];
  origin: [number, number, number];
}

/**
 * Density statistics over the oriented box. Iterates only the box's axis-aligned bounding
 * range of voxel indices, then keeps the voxels whose center passes the oriented-box test.
 * Returns null when the box contains no voxel centers (sub-voxel drag).
 */
export function computeRoi3dStats(
  scalar: Int16Array,
  geo: VolumeGeometry,
  center: [number, number, number],
  axes: [number[], number[], number[]],
  half: [number, number, number],
): Roi3dStats | null {
  const { dims, spacing, origin } = geo;
  const [cols, rows, slices] = dims;
  // world-space AABB of the oriented box: per world axis, sum of |axis contribution| * half
  const reach = [0, 1, 2].map(
    (w) => Math.abs(axes[0][w]) * half[0] + Math.abs(axes[1][w]) * half[1] + Math.abs(axes[2][w]) * half[2],
  );
  const lo = [0, 1, 2].map((w) =>
    Math.max(0, Math.floor((center[w] - reach[w] - origin[w]) / spacing[w])),
  );
  const hi = [
    Math.min(cols - 1, Math.ceil((center[0] + reach[0] - origin[0]) / spacing[0])),
    Math.min(rows - 1, Math.ceil((center[1] + reach[1] - origin[1]) / spacing[1])),
    Math.min(slices - 1, Math.ceil((center[2] + reach[2] - origin[2]) / spacing[2])),
  ];
  let n = 0;
  let sum = 0;
  let sumSq = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let z = lo[2]; z <= hi[2]; z++) {
    const wz = origin[2] + z * spacing[2] - center[2];
    for (let y = lo[1]; y <= hi[1]; y++) {
      const wy = origin[1] + y * spacing[1] - center[1];
      const rowBase = z * rows * cols + y * cols;
      for (let x = lo[0]; x <= hi[0]; x++) {
        const wx = origin[0] + x * spacing[0] - center[0];
        if (
          Math.abs(wx * axes[0][0] + wy * axes[0][1] + wz * axes[0][2]) > half[0] ||
          Math.abs(wx * axes[1][0] + wy * axes[1][1] + wz * axes[1][2]) > half[1] ||
          Math.abs(wx * axes[2][0] + wy * axes[2][1] + wz * axes[2][2]) > half[2]
        )
          continue;
        const v = scalar[rowBase + x];
        n++;
        sum += v;
        sumSq += v * v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!n) return null;
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  const voxelMm3 = spacing[0] * spacing[1] * spacing[2];
  return {
    nVoxels: n,
    meanHu: mean,
    sdHu: Math.sqrt(variance),
    minHu: min,
    maxHu: max,
    volumeCm3: (n * voxelMm3) / 1000,
  };
}

/** The 8 world-space corners of an ROI's oriented box (for the outline actor). */
export function roi3dCorners(roi: Roi3d): number[][] {
  const out: number[][] = [];
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      for (const sn of [-1, 1]) {
        out.push([0, 1, 2].map(
          (w) =>
            roi.center[w] +
            roi.axes[0][w] * roi.half[0] * su +
            roi.axes[1][w] * roi.half[1] * sv +
            roi.axes[2][w] * roi.half[2] * sn,
        ));
      }
    }
  }
  return out; // index bit-order: (su, sv, sn) → u*4 + v*2 + n
}

// 12 edges over the corner indexing above
const BOX_EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along n
  [0, 2], [1, 3], [4, 6], [5, 7], // along v
  [0, 4], [1, 5], [2, 6], [3, 7], // along u
];

interface VtkRendererish {
  addActor: (a: unknown) => void;
  removeActor: (a: unknown) => void;
}

// vtk classes are passed in by the caller (CbctViewport already bundles them via scene3d) to
// keep this module import-light; see Roi3dOutlines.create below.
interface VtkKit {
  vtkPolyData: { newInstance: () => VtkPolyDataish };
  vtkActor: { newInstance: () => VtkActorish };
  vtkMapper: { newInstance: () => VtkMapperish };
}
interface VtkPolyDataish {
  getPoints: () => { setData: (d: Float32Array, n: number) => void };
  getLines: () => { setData: (d: Uint32Array) => void };
  modified: () => void;
}
interface VtkMapperish { setInputData: (p: unknown) => void }
interface VtkActorish {
  setMapper: (m: unknown) => void;
  setVisibility: (v: boolean) => void;
  getProperty: () => {
    setColor: (r: number, g: number, b: number) => void;
    setLineWidth: (w: number) => void;
    setLighting: (l: boolean) => void;
  };
}

/**
 * Orange oriented-box outlines for every 3D ROI, drawn inside the 3D renderer (opaque lines,
 * same reasoning as the plane indicators — translucency degrades the volume pass).
 * `sync(rois)` rebuilds the actor set; selected ROI draws brighter + thicker.
 */
export class Roi3dOutlines {
  private renderer: VtkRendererish;
  private kit: VtkKit;
  private actors = new Map<string, { actor: VtkActorish; poly: VtkPolyDataish }>();

  constructor(renderer: VtkRendererish, kit: VtkKit) {
    this.renderer = renderer;
    this.kit = kit;
  }

  sync(rois: Roi3d[], selectedId: string | null) {
    const alive = new Set(rois.map((r) => r.id));
    for (const [id, e] of this.actors) {
      if (!alive.has(id)) {
        this.renderer.removeActor(e.actor);
        this.actors.delete(id);
      }
    }
    for (const roi of rois) {
      let e = this.actors.get(roi.id);
      if (!e) {
        const poly = this.kit.vtkPolyData.newInstance();
        poly.getPoints().setData(new Float32Array(24), 3);
        const cells = new Uint32Array(BOX_EDGES.length * 3);
        BOX_EDGES.forEach(([a, b], i) => {
          cells[i * 3] = 2;
          cells[i * 3 + 1] = a;
          cells[i * 3 + 2] = b;
        });
        poly.getLines().setData(cells);
        const mapper = this.kit.vtkMapper.newInstance();
        mapper.setInputData(poly);
        const actor = this.kit.vtkActor.newInstance();
        actor.setMapper(mapper);
        actor.getProperty().setLighting(false);
        this.renderer.addActor(actor);
        e = { actor, poly };
        this.actors.set(roi.id, e);
      }
      const corners = roi3dCorners(roi);
      const pts = new Float32Array(24);
      corners.forEach((c, i) => {
        pts[i * 3] = c[0];
        pts[i * 3 + 1] = c[1];
        pts[i * 3 + 2] = c[2];
      });
      e.poly.getPoints().setData(pts, 3);
      e.poly.modified();
      const p = e.actor.getProperty();
      const sel = roi.id === selectedId;
      p.setColor(1, sel ? 0.75 : 0.6, sel ? 0.3 : 0.12);
      p.setLineWidth(sel ? 3 : 2);
      e.actor.setVisibility(roi.visible);
    }
  }

  dispose() {
    try {
      for (const e of this.actors.values()) this.renderer.removeActor(e.actor);
    } catch {
      /* renderer already gone */
    }
    this.actors.clear();
  }
}
