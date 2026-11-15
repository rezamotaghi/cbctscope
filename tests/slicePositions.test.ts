// The slice positions written for a local volume (components/cbct/slicePositions.ts): slice i
// at origin z plus i times the z spacing, x and y unchanged, the direction identity.
import { describe, expect, it } from 'vitest';
import { slicePositions } from '../components/cbct/slicePositions';
import { generatePhantom } from '../lib/shared/phantom';

describe('slice positions of a local volume', () => {
  it("the phantom's geometry: one position per slice, z ascending by one spacing", () => {
    const { meta } = generatePhantom();
    const [ox, oy, oz] = meta.origin;
    const nz = meta.dims[2];
    const p = slicePositions(meta.origin, meta.spacing, nz);
    expect(p).toHaveLength(nz);
    expect(p[0]).toEqual([ox, oy, oz]);
    p.forEach(([x, y, z], i) => {
      expect(x).toBe(ox);
      expect(y).toBe(oy);
      expect(z).toBeCloseTo(oz + i * meta.spacing[2], 9);
    });
    expect(p[nz - 1][2]).toBeCloseTo(oz + (nz - 1) * meta.spacing[2], 9);
  });

  it('an odd z spacing and a non-zero origin', () => {
    const p = slicePositions([-12.5, 40.25, -63.7], [0.3, 0.3, 0.417], 5);
    expect(p.map(([x, y]) => [x, y])).toEqual(Array(5).fill([-12.5, 40.25]));
    const z = p.map(([, , v]) => v);
    [-63.7, -63.283, -62.866, -62.449, -62.032].forEach((want, i) => expect(z[i]).toBeCloseTo(want, 9));
  });

  it('only the z spacing moves a slice; no slices, no positions', () => {
    expect(slicePositions([1, 2, 3], [9, 9, 2], 2)).toEqual([
      [1, 2, 3],
      [1, 2, 5],
    ]);
    expect(slicePositions([1, 2, 3], [1, 1, 1], 0)).toEqual([]);
  });
});
