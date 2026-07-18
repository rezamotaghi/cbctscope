// The synthetic demo phantom: deterministic, well-formed, anatomically plausible HU content.
import { describe, expect, it } from 'vitest';
import { getPhantomVolume, PHANTOM_ID } from '../lib/server/phantom';
import { VOLUME_ID_RE } from '../lib/server/dicom';

describe('getPhantomVolume', () => {
  const vol = getPhantomVolume();

  it('has a servable id and consistent geometry', () => {
    expect(PHANTOM_ID).toMatch(VOLUME_ID_RE);
    expect(vol.meta.anon).toBe(PHANTOM_ID);
    const [nx, ny, nz] = vol.meta.dims;
    expect(vol.data.byteLength).toBe(nx * ny * nz * 2);
    expect(vol.meta.bytes).toBe(vol.data.byteLength);
  });

  it('is cached (one generation per process)', () => {
    expect(getPhantomVolume()).toBe(vol);
  });

  it('contains air, soft tissue, bone, and enamel-density voxels', () => {
    const vox = new Int16Array(vol.data.buffer, vol.data.byteOffset, vol.data.byteLength / 2);
    let air = 0;
    let soft = 0;
    let bone = 0;
    let enamel = 0;
    let outOfRange = 0;
    for (let i = 0; i < vox.length; i += 11) {
      const v = vox[i];
      if (v < -1000 || v > 3100) outOfRange++;
      if (v <= -900) air++;
      else if (v >= 0 && v <= 100) soft++;
      else if (v >= 1000 && v <= 1500) bone++;
      else if (v >= 2500) enamel++;
    }
    expect(outOfRange).toBe(0);
    expect(air).toBeGreaterThan(0);
    expect(soft).toBeGreaterThan(0);
    expect(bone).toBeGreaterThan(0);
    expect(enamel).toBeGreaterThan(0);
  });
});
