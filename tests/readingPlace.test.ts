// The reading place (components/cbct/readingPlace.ts): one crosshair point per volume, shared
// by every reading mode, so a mode switch keeps the axial level and the crosshair.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  armedPlace,
  axialIndexOf,
  getReadingPlace,
  initialAxialIndex,
  placeFor,
  planesIntersection,
  setAxialLevel,
  setReadingPlace,
  volumeCentre,
  withAxialIndex,
} from '../components/cbct/readingPlace';

const geo = { dims: [256, 256, 200], spacing: [0.4, 0.4, 0.4], origin: [-51, -51, -40] };

describe('the reading place, pure', () => {
  it('belongs to one volume', () => {
    const p = { anon: 'a', world: [1, 2, 3] as [number, number, number] };
    expect(placeFor(p, 'a')).toBe(p);
    expect(placeFor(p, 'b')).toBeNull();
    expect(placeFor(null, 'a')).toBeNull();
  });
  it('maps its z to the axial voxel index and back, clamped into the volume', () => {
    const p = withAxialIndex(null, 'a', geo, 120);
    expect(axialIndexOf(p, geo)).toBe(120);
    // x and y start at the volume centre when there was no crosshair yet
    expect(p.world.slice(0, 2)).toEqual(volumeCentre(geo).slice(0, 2));
    expect(axialIndexOf({ anon: 'a', world: [0, 0, -1000] }, geo)).toBe(0);
    expect(axialIndexOf({ anon: 'a', world: [0, 0, 1000] }, geo)).toBe(199);
  });
  it('an axial move keeps the crosshair x and y', () => {
    const before = { anon: 'a', world: [5, -7, 0] as [number, number, number] };
    const after = withAxialIndex(before, 'a', geo, 30);
    expect(after.world[0]).toBe(5);
    expect(after.world[1]).toBe(-7);
    expect(after.world[2]).toBeCloseTo(-40 + 30 * 0.4);
  });
  it('finds the crosshair centre where three slice planes meet, oblique ones too', () => {
    expect(
      planesIntersection([
        { normal: [0, 0, 1], point: [9, 9, 4] },
        { normal: [1, 0, 0], point: [2, 9, 9] },
        { normal: [0, 1, 0], point: [9, -3, 9] },
      ]),
    ).toEqual([2, -3, 4]);
    const s = Math.SQRT1_2;
    const target = [1.5, -2, 7];
    // each plane passes through the target, offset along itself so the given point differs
    const planes = [
      { normal: [s, s, 0], point: [target[0] - 3 * s, target[1] + 3 * s, target[2] + 4] },
      { normal: [-s, s, 0], point: [target[0] + 2 * s, target[1] + 2 * s, target[2] - 1] },
      { normal: [0, 0, 1], point: [target[0] + 10, target[1] - 5, target[2]] },
    ];
    const got = planesIntersection(planes)!;
    got.forEach((v, i) => expect(v).toBeCloseTo(target[i]));
  });
  it('gives nothing when two planes are parallel', () => {
    expect(
      planesIntersection([
        { normal: [0, 0, 1], point: [0, 0, 0] },
        { normal: [0, 0, 1], point: [0, 0, 1] },
        { normal: [1, 0, 0], point: [0, 0, 0] },
      ]),
    ).toBeNull();
  });
});

describe('the reading place across a mode switch', () => {
  beforeEach(() => setReadingPlace({ anon: 'none', world: [0, 0, 0] }));
  it('MPR at axial 120 opens Pano at 120, and MPR comes back at 120 with the crosshair where it was', () => {
    // MPR: the crosshair is spotted at x 5, y -7 on axial voxel 120
    const z120 = geo.origin[2] + 120 * geo.spacing[2];
    setReadingPlace({ anon: 'vol', world: [5, -7, z120] });
    // Pano opens: its own saved level (90) gives way to the place
    expect(initialAxialIndex('vol', geo, 90)).toBe(120);
    // Pano scrolls to 110, then back to 120
    setAxialLevel('vol', geo, 110);
    expect(axialIndexOf(getReadingPlace('vol')!, geo)).toBe(110);
    setAxialLevel('vol', geo, 120);
    // MPR remounts: the crosshair and the level are where they were
    const back = getReadingPlace('vol')!;
    expect(back.world[0]).toBe(5);
    expect(back.world[1]).toBe(-7);
    expect(axialIndexOf(back, geo)).toBe(120);
  });
  it('another volume starts fresh', () => {
    setReadingPlace({ anon: 'vol', world: [5, -7, 8] });
    expect(getReadingPlace('other')).toBeNull();
    expect(initialAxialIndex('other', geo, 90)).toBe(90);
  });
});

describe('the paired series of one acquisition share one place', () => {
  beforeEach(() => setReadingPlace({ anon: 'none', world: [0, 0, 0] }));
  const geoA = { ...geo, pair: 'B' };
  const geoB = { ...geo, pair: 'A' };
  it('a level set on one series opens its pair on the same level, in Pano, TMJ, Reslice and Region alike', () => {
    setReadingPlace({ anon: 'A', world: [5, -7, geo.origin[2] + 120 * geo.spacing[2]] });
    // every axial scout reads the place through initialAxialIndex with its volume's meta
    expect(initialAxialIndex('B', geoB, 90)).toBe(120);
    // the pair writes its own move and keeps the crosshair's x and y
    setAxialLevel('B', geoB, 130);
    const p = getReadingPlace('A', 'B')!;
    expect(p.world.slice(0, 2)).toEqual([5, -7]);
    expect(initialAxialIndex('A', geoA, 90)).toBe(130);
    expect(placeFor(p, 'A', 'B')).toBe(p);
  });
  it('a volume outside the pair starts fresh', () => {
    setReadingPlace({ anon: 'A', world: [5, -7, 8] });
    expect(getReadingPlace('C', null)).toBeNull();
    expect(initialAxialIndex('C', { ...geo, pair: null }, 90)).toBe(90);
  });
});

describe('the place across a volume switch', () => {
  beforeEach(() => setReadingPlace({ anon: 'none', world: [0, 0, 0] }));
  it('a scout move keeps x and y on one volume, and a switch keeps the volumes apart', () => {
    setReadingPlace({ anon: 'vol', world: [5, -7, 8] });
    for (const z of [10, 150, 60]) {
      setAxialLevel('vol', geo, z);
      const p = getReadingPlace('vol')!;
      expect(p.world[0]).toBe(5);
      expect(p.world[1]).toBe(-7);
      expect(axialIndexOf(p, geo)).toBe(z);
    }
    // the other volume's first scout move starts from its own centre, not from vol's x and y
    setAxialLevel('other', geo, 20);
    const o = getReadingPlace('other')!;
    expect(o.world.slice(0, 2)).toEqual(volumeCentre(geo).slice(0, 2));
    expect(getReadingPlace('vol')).toBeNull();
  });
  it('the MPR viewport writes only while armed for the volume on screen', () => {
    const w: [number, number, number] = [1, 2, 3];
    // armed for vol, vol on screen: written
    expect(armedPlace('vol', 'vol', w)).toEqual({ anon: 'vol', world: w });
    // the render where the id changes to next: the arming still names vol, so a camera
    // event from vol's panes writes nothing under next
    expect(armedPlace('vol', 'next', w)).toBeNull();
    // the load disarms, then re-arms for next once next's place is applied
    expect(armedPlace(null, 'next', w)).toBeNull();
    expect(armedPlace('next', 'next', w)).toEqual({ anon: 'next', world: w });
    // planes that do not meet write nothing
    expect(armedPlace('next', 'next', null)).toBeNull();
  });
});
