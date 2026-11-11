// The reading place: where the reader is in the open volume, shared by every reading mode so
// a mode switch keeps it. One world point in patient mm: the MPR crosshair centre, whose z is
// the axial level every axial scout (Pano, TMJ, Reslice, Region) opens on. MPR at axial slice
// 120 opens Pano on slice 120, and MPR comes back at 120 with the crosshair where it was.
// It lives in this tab's memory only, for the open volume, and is never written anywhere.

export type Vec3 = [number, number, number];

export interface ReadingPlace {
  /** the volume it belongs to; a place never carries over to another volume */
  anon: string;
  /** the crosshair centre in patient mm (identity direction: x, y, z along the voxel axes) */
  world: Vec3;
}

export interface VolumeGeometry {
  dims: readonly number[];
  spacing: readonly number[];
  origin: readonly number[];
}

/** the place for this volume, or null when the stored one belongs to another (or none is stored) */
export function placeFor(place: ReadingPlace | null, anon: string): ReadingPlace | null {
  return place && place.anon === anon ? place : null;
}

/** the axial voxel index (buffer z, 0 = the first slice in the file) of a place, clamped into the volume */
export function axialIndexOf(place: ReadingPlace, geo: VolumeGeometry): number {
  const z = Math.round((place.world[2] - geo.origin[2]) / geo.spacing[2]);
  return Math.max(0, Math.min(geo.dims[2] - 1, z));
}

/** the volume's centre in patient mm */
export function volumeCentre(geo: VolumeGeometry): Vec3 {
  return [0, 1, 2].map((i) => geo.origin[i] + ((geo.dims[i] - 1) * geo.spacing[i]) / 2) as Vec3;
}

/**
 * A place moved to another axial level (an axial scout's slider or wheel): z follows the
 * index, x and y stay where the crosshair was (the volume centre when there was none).
 */
export function withAxialIndex(place: ReadingPlace | null, anon: string, geo: VolumeGeometry, z: number): ReadingPlace {
  const prev = placeFor(place, anon)?.world ?? volumeCentre(geo);
  return { anon, world: [prev[0], prev[1], geo.origin[2] + z * geo.spacing[2]] };
}

/**
 * The point where three slice planes meet (each a normal and a point on it): the crosshair
 * centre of the MPR panes, oblique or not. Null when two planes are (nearly) parallel.
 */
export function planesIntersection(planes: readonly { normal: readonly number[]; point: readonly number[] }[]): Vec3 | null {
  if (planes.length !== 3) return null;
  const [a, b, c] = planes.map((p) => p.normal);
  const d = planes.map((p) => p.normal[0] * p.point[0] + p.normal[1] * p.point[1] + p.normal[2] * p.point[2]);
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (Math.abs(det) < 1e-6) return null;
  // Cramer's rule: n_i . x = d_i
  const col = (i: number, v: number[]) => [a, b, c].map((n, r) => n.map((x, k) => (k === i ? v[r] : x)));
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  return [det3(col(0, d)) / det, det3(col(1, d)) / det, det3(col(2, d)) / det];
}

// ---- the tab's one place (module memory: survives a mode switch, gone with the tab)
let current: ReadingPlace | null = null;

/** the stored place for this volume, or null */
export function getReadingPlace(anon: string): ReadingPlace | null {
  return placeFor(current, anon);
}

/** store the place (each reading mode writes it as the reader moves) */
export function setReadingPlace(place: ReadingPlace): void {
  current = { anon: place.anon, world: [place.world[0], place.world[1], place.world[2]] };
}

/** an axial scout moved: store its level, keeping the crosshair's x and y */
export function setAxialLevel(anon: string, geo: VolumeGeometry, z: number): void {
  setReadingPlace(withAxialIndex(current, anon, geo, z));
}

/** the axial index an axial scout opens on: the stored place, else `fallback` */
export function initialAxialIndex(anon: string, geo: VolumeGeometry, fallback: number): number {
  const p = getReadingPlace(anon);
  return p ? axialIndexOf(p, geo) : fallback;
}
