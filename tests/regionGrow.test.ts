// Region growing: 6-connected HU-band flood fill inside a bounding box.
import { describe, expect, it } from 'vitest';
import { growRegion, HU_PRESETS } from '../components/cbct/regionGrow';
import type { CbctMeta, VolumeEntry } from '../components/cbct/volumeData';

const DIM = 40;
const SP = 0.5; // mm

function makeVolume(): VolumeEntry {
  const scalar = new Int16Array(DIM * DIM * DIM).fill(-1000);
  const c = DIM / 2;
  const r = 8; // voxels
  for (let z = 0; z < DIM; z++)
    for (let y = 0; y < DIM; y++)
      for (let x = 0; x < DIM; x++) {
        const d2 = (x - c) ** 2 + (y - c) ** 2 + (z - c) ** 2;
        if (d2 < r * r) scalar[z * DIM * DIM + y * DIM + x] = 1000;
      }
  const meta: CbctMeta = {
    anon: 'local_cccccccccccc',
    kind: 'mf',
    dims: [DIM, DIM, DIM],
    spacing: [SP, SP, SP],
    origin: [0, 0, 0],
    fov: [2, 2],
    region: '',
    year: '',
    pair: null,
    defaultVoi: { center: 0, width: 2000 },
    bytes: scalar.byteLength,
  };
  return { meta, scalar };
}

const FULL_BOX = { x0: 0, x1: DIM - 1, y0: 0, y1: DIM - 1, z0: 0, z1: DIM - 1 };

describe('growRegion', () => {
  it('fills a dense sphere from a center seed and nothing else', () => {
    const vol = makeVolume();
    const res = growRegion(vol, [DIM / 2, DIM / 2, DIM / 2], HU_PRESETS.bone.lo, HU_PRESETS.bone.hi, FULL_BOX, false);
    expect(res).not.toBeNull();
    const ideal = (4 / 3) * Math.PI * 8 ** 3;
    expect(res!.capped).toBe(false);
    // voxelized sphere: within 10% of the analytic volume
    expect(Math.abs(res!.voxelCount - ideal) / ideal).toBeLessThan(0.1);
  });

  it('rejects a seed whose HU is outside the band', () => {
    const vol = makeVolume();
    const res = growRegion(vol, [1, 1, 1], HU_PRESETS.bone.lo, HU_PRESETS.bone.hi, FULL_BOX, false);
    expect(res).toBeNull();
  });

  it('stays inside the bounding box', () => {
    const vol = makeVolume();
    const half = { x0: 0, x1: DIM / 2, y0: 0, y1: DIM - 1, z0: 0, z1: DIM - 1 };
    const res = growRegion(vol, [DIM / 2 - 1, DIM / 2, DIM / 2], HU_PRESETS.bone.lo, HU_PRESETS.bone.hi, half, false);
    expect(res).not.toBeNull();
    // a half-box cuts the sphere roughly in half
    const ideal = (4 / 3) * Math.PI * 8 ** 3;
    expect(res!.voxelCount).toBeLessThan(ideal * 0.75);
    expect(res!.voxelCount).toBeGreaterThan(ideal * 0.3);
  });
});
