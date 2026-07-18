// Volume stitching math: normalized cross-correlation + rigid auto-registration.
import { describe, expect, it } from 'vitest';
import { autoRegister, nccScore, IDENTITY } from '../components/cbct/stitch';
import type { CbctMeta, VolumeEntry } from '../components/cbct/volumeData';

const DIM = 48;
const SP = 1; // 1 mm voxels keep world = voxel coords

function makeMeta(anon: string): CbctMeta {
  return {
    anon,
    kind: 'mf',
    dims: [DIM, DIM, DIM],
    spacing: [SP, SP, SP],
    origin: [0, 0, 0],
    fov: [DIM / 10, DIM / 10],
    region: '',
    year: '',
    pair: null,
    defaultVoi: { center: 500, width: 2000 },
    bytes: DIM * DIM * DIM * 2,
  };
}

/** deterministic test volume: three dense ellipsoids on a soft background */
function makeVolume(anon: string, shift: [number, number, number]): VolumeEntry {
  const scalar = new Int16Array(DIM * DIM * DIM).fill(0);
  const blobs: [number, number, number, number][] = [
    [24, 24, 24, 8],
    [14, 30, 18, 5],
    [32, 16, 30, 4],
  ];
  for (let z = 0; z < DIM; z++)
    for (let y = 0; y < DIM; y++)
      for (let x = 0; x < DIM; x++) {
        for (const [cx, cy, cz, r] of blobs) {
          const dx = x - (cx + shift[0]);
          const dy = y - (cy + shift[1]);
          const dz = z - (cz + shift[2]);
          if (dx * dx + dy * dy + dz * dz < r * r) {
            scalar[z * DIM * DIM + y * DIM + x] = 1200;
            break;
          }
        }
      }
  return { meta: makeMeta(anon), scalar };
}

describe('nccScore', () => {
  it('is ~1 for a volume against itself and lower against a shifted copy', () => {
    const A = makeVolume('local_aaaaaaaaaaaa', [0, 0, 0]);
    const B = makeVolume('local_bbbbbbbbbbbb', [5, -3, 2]);
    expect(nccScore(A, A, IDENTITY)).toBeGreaterThan(0.99);
    expect(nccScore(A, B, IDENTITY)).toBeLessThan(nccScore(A, A, IDENTITY));
  });

  it('peaks at the true translation', () => {
    const A = makeVolume('local_aaaaaaaaaaaa', [0, 0, 0]);
    const B = makeVolume('local_bbbbbbbbbbbb', [5, -3, 2]);
    // B's content sits at +[5,-3,2] voxels = mm, so mapping A's points into B needs t = -shift
    const truth = { t: [-5, 3, -2] as [number, number, number], r: [0, 0, 0] as [number, number, number] };
    expect(nccScore(A, B, truth)).toBeGreaterThan(nccScore(A, B, IDENTITY) + 0.1);
    expect(nccScore(A, B, truth)).toBeGreaterThan(0.95);
  });
});

describe('autoRegister', () => {
  it('recovers a pure translation within 2 mm', () => {
    const A = makeVolume('local_aaaaaaaaaaaa', [0, 0, 0]);
    const B = makeVolume('local_bbbbbbbbbbbb', [6, -4, 2]);
    const rigid = autoRegister(A, B, false);
    expect(Math.abs(rigid.t[0] - -6)).toBeLessThanOrEqual(2);
    expect(Math.abs(rigid.t[1] - 4)).toBeLessThanOrEqual(2);
    expect(Math.abs(rigid.t[2] - -2)).toBeLessThanOrEqual(2);
    expect(nccScore(A, B, rigid)).toBeGreaterThan(0.9);
  });
});
