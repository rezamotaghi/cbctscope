// 3D-scene extras for the CBCT viewer:
//  - crop-for-3D + cutaway, both via vtk CLIPPING PLANES: a clipping plane tells
//    the GPU ray-march "skip every voxel on this side of an infinite plane". Crop = up to six
//    axis-aligned planes forming a box; a cutaway cut = one plane oriented to the
//    viewing direction at drag time, pushed deeper into the anatomy as the drag moves. The
//    planes live on the 3D viewport's own mapper, so the MPR slices are never affected.
//  - plane indicators: the three MPR section planes + the volume bounding box drawn INSIDE
//    the 3D render as lightweight vtk geometry (colors match the reference lines).
import type { RenderingEngine } from '@cornerstonejs/core';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkCubeSource from '@kitware/vtk.js/Filters/Sources/CubeSource';
import vtkOutlineFilter from '@kitware/vtk.js/Filters/General/OutlineFilter';

// vtk building blocks handed to evidence3d's Roi3dOutlines (keeps that module free of
// direct @kitware imports — one bundling site for the vtk classes).
export const VTK_KIT = { vtkPolyData, vtkActor, vtkMapper };

/** Crop box as per-axis kept fractions of the volume extent (0..1). x=R→L, y=A→P, z=I→S. */
export interface Crop3d {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}
export const FULL_CROP: Crop3d = { x: [0, 1], y: [0, 1], z: [0, 1] };
export const isFullCrop = (c: Crop3d) =>
  c.x[0] <= 0 && c.x[1] >= 1 && c.y[0] <= 0 && c.y[1] >= 1 && c.z[0] <= 0 && c.z[1] >= 1;

/** One cutaway cut. `normal` points INTO the kept half-space (away from the camera). */
export interface Cut {
  origin: [number, number, number];
  normal: [number, number, number];
}

interface VtkActorish {
  getBounds: () => number[]; // [x0,x1,y0,y1,z0,z1]
  getMapper: () => {
    addClippingPlane: (p: unknown) => void;
    removeAllClippingPlanes: () => void;
    modified: () => void;
  };
}

function volumeActorOf(engine: RenderingEngine, viewportId: string): VtkActorish | null {
  try {
    const vp = engine.getViewport(viewportId);
    return (vp.getDefaultActor()?.actor as unknown as VtkActorish) ?? null;
  } catch {
    return null;
  }
}

/**
 * Rebuild the 3D mapper's clipping-plane set from the crop box + accumulated cuts.
 * Idempotent — call it whenever either changes or the actor is recreated (volume switch).
 */
export function applyClipping(engine: RenderingEngine, viewportId: string, crop: Crop3d, cuts: Cut[]) {
  const actor = volumeActorOf(engine, viewportId);
  if (!actor) return;
  const mapper = actor.getMapper();
  mapper.removeAllClippingPlanes();
  const b = actor.getBounds();
  const fracs: [number, number][] = [crop.x, crop.y, crop.z];
  for (let axis = 0; axis < 3; axis++) {
    const lo = b[axis * 2];
    const hi = b[axis * 2 + 1];
    const [flo, fhi] = fracs[axis];
    if (flo > 0.001) {
      const origin: number[] = [0, 0, 0];
      const normal: number[] = [0, 0, 0];
      origin[axis] = lo + flo * (hi - lo);
      normal[axis] = 1; // keep the high side
      mapper.addClippingPlane(vtkPlane.newInstance({ origin, normal } as never));
    }
    if (fhi < 0.999) {
      const origin: number[] = [0, 0, 0];
      const normal: number[] = [0, 0, 0];
      origin[axis] = lo + fhi * (hi - lo);
      normal[axis] = -1; // keep the low side
      mapper.addClippingPlane(vtkPlane.newInstance({ origin, normal } as never));
    }
  }
  for (const c of cuts) {
    mapper.addClippingPlane(vtkPlane.newInstance({ origin: [...c.origin], normal: [...c.normal] } as never));
  }
  mapper.modified();
  try {
    engine.getViewport(viewportId).render();
  } catch {
    /* mid-teardown */
  }
}

/** Center + half-diagonal of an actor's bounds — the cut plane starts at the near surface. */
export function boundsInfo(engine: RenderingEngine, viewportId: string) {
  const actor = volumeActorOf(engine, viewportId);
  if (!actor) return null;
  const b = actor.getBounds();
  const center: [number, number, number] = [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2];
  const halfDiag = Math.hypot(b[1] - b[0], b[3] - b[2], b[5] - b[4]) / 2;
  return { center, halfDiag };
}

// ---------------- plane indicators ----------------

export interface PaneIndicatorState {
  color: [number, number, number];
  focal: number[];
  normal: number[];
}

interface VtkRendererish {
  addActor: (a: unknown) => void;
  removeActor: (a: unknown) => void;
}

function norm(v: number[]): number[] {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}
function crossV(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Bounding box outline + one colored rectangle FRAME per MPR pane (closed polyline), drawn
 * inside the 3D renderer and following the panes' live cameras (focal point + view normal),
 * so they stay honest under oblique section rotation.
 * Frames are OPAQUE lines on purpose: translucent polygons force vtk's mixed-translucency
 * path and visibly degrade the volume render (verified 2026-07-11).
 */
export class PlaneIndicators {
  private renderer: VtkRendererish;
  private boxSource = vtkCubeSource.newInstance();
  private boxActor = vtkActor.newInstance();
  private framePolys = [vtkPolyData.newInstance(), vtkPolyData.newInstance(), vtkPolyData.newInstance()];
  private frameActors = [vtkActor.newInstance(), vtkActor.newInstance(), vtkActor.newInstance()];
  private size = 100;
  private visible = false;

  constructor(renderer: VtkRendererish) {
    this.renderer = renderer;
    const outline = vtkOutlineFilter.newInstance();
    outline.setInputConnection(this.boxSource.getOutputPort());
    const boxMapper = vtkMapper.newInstance();
    boxMapper.setInputConnection(outline.getOutputPort());
    this.boxActor.setMapper(boxMapper);
    this.boxActor.getProperty().setColor(0.55, 0.6, 0.7);
    this.boxActor.getProperty().setLineWidth(1.5);
    this.boxActor.setVisibility(false);
    renderer.addActor(this.boxActor);
    for (let i = 0; i < 3; i++) {
      const poly = this.framePolys[i];
      poly.getPoints().setData(new Float32Array(12), 3);
      // one closed polyline over the 4 corners: [nPts, i0, i1, i2, i3, i0]
      poly.getLines().setData(new Uint32Array([5, 0, 1, 2, 3, 0]));
      const m = vtkMapper.newInstance();
      m.setInputData(poly);
      this.frameActors[i].setMapper(m);
      const p = this.frameActors[i].getProperty();
      p.setLighting(false);
      p.setLineWidth(2);
      this.frameActors[i].setVisibility(false);
      this.renderer.addActor(this.frameActors[i]);
    }
  }

  /** Re-fit to a (new) volume's world bounds. */
  setBounds(bounds: number[]) {
    this.boxSource.setXLength(bounds[1] - bounds[0]);
    this.boxSource.setYLength(bounds[3] - bounds[2]);
    this.boxSource.setZLength(bounds[5] - bounds[4]);
    this.boxSource.setCenter(
      (bounds[0] + bounds[1]) / 2,
      (bounds[2] + bounds[3]) / 2,
      (bounds[4] + bounds[5]) / 2,
    );
    this.size = Math.hypot(bounds[1] - bounds[0], bounds[3] - bounds[2], bounds[5] - bounds[4]) * 0.72;
  }

  /** Reposition the three frames from the MPR panes' live cameras. */
  update(panes: PaneIndicatorState[]) {
    for (let i = 0; i < Math.min(3, panes.length); i++) {
      const { color, focal, normal } = panes[i];
      const n = norm(normal);
      const seed = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const u = norm(crossV(n, seed));
      const v = crossV(n, u);
      const h = this.size / 2;
      const pts = new Float32Array(12);
      const corner = (out: number, su: number, sv: number) => {
        pts[out] = focal[0] + (u[0] * su + v[0] * sv) * h;
        pts[out + 1] = focal[1] + (u[1] * su + v[1] * sv) * h;
        pts[out + 2] = focal[2] + (u[2] * su + v[2] * sv) * h;
      };
      corner(0, -1, -1);
      corner(3, 1, -1);
      corner(6, 1, 1);
      corner(9, -1, 1);
      this.framePolys[i].getPoints().setData(pts, 3);
      this.framePolys[i].modified();
      this.frameActors[i].getProperty().setColor(color[0], color[1], color[2]);
    }
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.boxActor.setVisibility(v);
    for (const a of this.frameActors) a.setVisibility(v);
  }

  isVisible() {
    return this.visible;
  }

  dispose() {
    try {
      this.renderer.removeActor(this.boxActor);
      for (const a of this.frameActors) this.renderer.removeActor(a);
    } catch {
      /* renderer already gone */
    }
  }
}
