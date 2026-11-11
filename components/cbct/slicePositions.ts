// Where each axial slice of a local volume sits, in patient mm. Cornerstone's createLocalVolume
// gives every slice the volume origin; CbctViewport writes these positions over that instead.
// The direction is identity, so slice i sits i z spacings above the origin, x and y unchanged.

export type Vec3 = [number, number, number];

/** imagePositionPatient of every slice: origin + i * spacing[2] along z, for i = 0 .. slices-1 */
export function slicePositions(origin: readonly number[], spacing: readonly number[], slices: number): Vec3[] {
  const [ox, oy, oz] = origin;
  const dz = spacing[2];
  return Array.from({ length: slices }, (_, i): Vec3 => [ox, oy, oz + i * dz]);
}
