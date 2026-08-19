// Pure viewer geometry: where a slice sits, and which way the patient is facing.
//
// Deliberately split out of CbctViewport. Everything here fails SILENTLY when it is wrong —
// a flipped slider, a swapped L/R marker, a rotation running backwards all still render a
// perfectly plausible image, and the only way to catch them is to notice the anatomy
// disagrees with the label. That makes this the part of the viewer that has to be unit
// tested, so it is kept free of React, Cornerstone, and the DOM: import and call.
//
// Convention throughout is LPS (+x = patient Left, +y = Posterior, +z = Superior), which is
// what the volume contract delivers.

export type MprPane = 'axial' | 'sagittal' | 'coronal';

/** Cornerstone viewport ids, one per pane. */
export const VP: Record<MprPane | 'v3d', string> = {
  axial: 'cbct-axial',
  sagittal: 'cbct-sagittal',
  coronal: 'cbct-coronal',
  v3d: 'cbct-3d',
};

export const MPR_PANES: MprPane[] = ['axial', 'sagittal', 'coronal'];
export const MPR_IDS = MPR_PANES.map((p) => VP[p]);

// Slice-slider anatomy (verified against the crosshair reference lines, 2026-07-09):
// Cornerstone's index order runs superior→inferior on AXIAL, so that slider is FLIPPED to keep
// drag-up = toward the skull (radiology convention). Sagittal/coronal keep index order
// (up = patient L / up = anterior); the tooltip states each pane's direction.
export const SLIDER_FLIP: Record<string, boolean> = { [VP.axial]: true };
export const SLIDER_TIP: Record<string, string> = {
  [VP.axial]: 'slice position · up = superior (S)',
  [VP.sagittal]: 'slice position · up = patient left (L)',
  [VP.coronal]: 'slice position · up = anterior (A)',
};

/** Slice index → slider position (inverse of sliceIndexFor). */
export function sliceValue(id: string, info: { idx: number; n: number }): number {
  return SLIDER_FLIP[id] ? info.n - 1 - info.idx : info.idx;
}

/** Slider position → slice index (inverse of sliceValue). */
export function sliceIndexFor(id: string, sliderValue: number, n: number): number {
  return SLIDER_FLIP[id] ? n - 1 - sliderValue : sliderValue;
}

// ---- slice ordinals: ONE convention for every slice number a reader sees or exports.
//
// Cornerstone's slice index counts along the pane camera's +viewPlaneNormal (its
// constants/mprCameraValues): axial [0,0,-1] → superior→inferior, coronal [0,-1,0] →
// posterior→anterior, sagittal [1,0,0] → right→left. The volume buffer is LPS-ascending on
// every axis, so the axial and coronal panes count AGAINST it (pane index 0 = buffer n-1).
// Two conventions once coexisted on screen — MPR printed the pane index ("AXIAL 622/801") while
// the Pano/TMJ/Reslice/Region scouts printed the buffer z ("AXIAL 180/801") for the SAME slice,
// the two always summing to n+1 — which is a transcription hazard in a two-reader workflow.
// Decision (2026-08-19): the PANE count, 1-based, wins everywhere — it is what the composed
// snapshots already bake in, what the MPR marks persist, and it matches how CT instance numbers
// usually run. Every readout, scout caption, snapshot label and print caption goes through
// these helpers, and the direction is printed beside the number so "622/801" can never again
// be read from the wrong end.
export const PANE_COUNTS_AGAINST_BUFFER: Record<MprPane, boolean> = {
  axial: true,
  coronal: true,
  sagittal: false,
};

/** Buffer voxel index along a pane's axis → that pane's slice index. An involution: the same
 *  formula maps a pane index back to the buffer. */
export function paneIndexFromBuffer(pane: MprPane, bufferIdx: number, n: number): number {
  return PANE_COUNTS_AGAINST_BUFFER[pane] ? n - 1 - bufferIdx : bufferIdx;
}

/** Pane slice index → buffer voxel index along that pane's axis (inverse of paneIndexFromBuffer). */
export function bufferIndexFromPane(pane: MprPane, paneIdx: number, n: number): number {
  return PANE_COUNTS_AGAINST_BUFFER[pane] ? n - 1 - paneIdx : paneIdx;
}

export interface SliceDirection {
  /** the anatomical end where slice 1 sits */
  from: string;
  /** the anatomical end where slice n sits */
  to: string;
}

/** The direction a pane's count runs on its DEFAULT (orthogonal) camera. The rooms that
 *  scroll a plain axial scout (Pano/TMJ/Reslice/Region) use `axial` directly. */
export const PANE_DIRECTION: Record<MprPane, SliceDirection> = {
  axial: { from: 'S', to: 'I' },
  coronal: { from: 'P', to: 'A' },
  sagittal: { from: 'R', to: 'L' },
};

/** The direction a pane's count runs from its LIVE camera, so an obliqued pane stays honest:
 *  slice 1 sits at the −viewPlaneNormal end, slice n at the +viewPlaneNormal end. Null before
 *  the camera exists. */
export function sliceDirection(cam: CameraLike): SliceDirection | null {
  const v = cam.viewPlaneNormal;
  if (!v) return null;
  return { from: axisLabel([-v[0], -v[1], -v[2]]), to: axisLabel(v) };
}

/** The 1-based ordinal text a reader sees — "622/801 S→I" — from a PANE index. */
export function sliceOrdinal(paneIdx: number, n: number, dir?: SliceDirection | null): string {
  const base = `${paneIdx + 1}/${n}`;
  return dir ? `${base} ${dir.from}→${dir.to}` : base;
}

// ---- patient-orientation markers, from the LIVE camera so they stay honest under
// crosshair/oblique rotation. right = viewUp × viewPlaneNormal.

/** Structural stand-in for Cornerstone's ICamera: only the two vectors matter here. */
export interface CameraLike {
  viewUp?: readonly number[];
  viewPlaneNormal?: readonly number[];
}

export interface Markers {
  right: string;
  left: string;
  top: string;
  bottom: string;
}

/** The dominant LPS axis of a direction vector, as its anatomical letter. */
export function axisLabel(v: readonly number[]): string {
  const ax = Math.abs(v[0]),
    ay = Math.abs(v[1]),
    az = Math.abs(v[2]);
  if (ax >= ay && ax >= az) return v[0] >= 0 ? 'L' : 'R';
  if (ay >= ax && ay >= az) return v[1] >= 0 ? 'P' : 'A';
  return v[2] >= 0 ? 'S' : 'I';
}

export function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** The four edge letters for a pane, or null before the camera exists. */
export function markersFromCamera(cam: CameraLike): Markers | null {
  if (!cam.viewUp || !cam.viewPlaneNormal) return null;
  const r = cross(cam.viewUp, cam.viewPlaneNormal);
  const t = cam.viewUp;
  const neg = (v: readonly number[]): [number, number, number] => [-v[0], -v[1], -v[2]];
  return {
    right: axisLabel(r),
    left: axisLabel(neg(r)),
    top: axisLabel(t),
    bottom: axisLabel(neg(t)),
  };
}

export function normalizeV(v: number[]): number[] {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

/** Rodrigues rotation of v around unit axis by deg. */
export function rotateVec(v: number[], axis: number[], deg: number): number[] {
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
