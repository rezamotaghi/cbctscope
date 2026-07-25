// Viewer geometry: slice-slider direction, patient-orientation markers, vector math.
import { describe, expect, it } from 'vitest';
import {
  VP,
  MPR_IDS,
  MPR_PANES,
  axisLabel,
  cross,
  markersFromCamera,
  normalizeV,
  rotateVec,
  sliceIndexFor,
  sliceValue,
} from '../components/cbct/geometry';

// These guard the silent failures: a flipped slider or a swapped L/R marker still draws a
// perfectly plausible image. Assertions are written in anatomy, not in arithmetic.
// Convention is LPS: +x = patient Left, +y = Posterior, +z = Superior.

describe('slice slider direction', () => {
  it('flips the axial slider so the top of the track is the top of the head', () => {
    const n = 200;
    // Cornerstone indexes axial superior→inferior, so index 0 is the most superior slice and
    // has to sit at the TOP of the slider.
    expect(sliceValue(VP.axial, { idx: 0, n })).toBe(n - 1);
    expect(sliceValue(VP.axial, { idx: n - 1, n })).toBe(0);
  });

  it('leaves sagittal and coronal in index order', () => {
    const n = 200;
    for (const id of [VP.sagittal, VP.coronal]) {
      expect(sliceValue(id, { idx: 0, n })).toBe(0);
      expect(sliceValue(id, { idx: n - 1, n })).toBe(n - 1);
    }
  });

  it('round-trips on every pane: index → slider → index', () => {
    const n = 137; // odd, so a mid-point bug cannot hide behind symmetry
    for (const id of MPR_IDS) {
      for (const idx of [0, 1, 42, 68, n - 2, n - 1]) {
        expect(sliceIndexFor(id, sliceValue(id, { idx, n }), n)).toBe(idx);
      }
    }
  });

  it('keeps every slider position inside the stack', () => {
    const n = 64;
    for (const id of MPR_IDS) {
      for (let idx = 0; idx < n; idx++) {
        const v = sliceValue(id, { idx, n });
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(n);
      }
    }
  });

  it('covers all three panes', () => {
    expect(MPR_PANES).toEqual(['axial', 'sagittal', 'coronal']);
    expect(MPR_IDS).toHaveLength(3);
    expect(new Set(MPR_IDS).size).toBe(3); // no two panes share a viewport id
  });
});

describe('axisLabel', () => {
  it('names each LPS axis with its anatomical letter', () => {
    expect(axisLabel([1, 0, 0])).toBe('L');
    expect(axisLabel([-1, 0, 0])).toBe('R');
    expect(axisLabel([0, 1, 0])).toBe('P');
    expect(axisLabel([0, -1, 0])).toBe('A');
    expect(axisLabel([0, 0, 1])).toBe('S');
    expect(axisLabel([0, 0, -1])).toBe('I');
  });

  it('picks the dominant axis when the vector is oblique', () => {
    expect(axisLabel([0.9, 0.3, 0.2])).toBe('L');
    expect(axisLabel([0.2, -0.8, 0.3])).toBe('A');
    expect(axisLabel([0.1, 0.2, -0.95])).toBe('I');
  });
});

// Cornerstone's own MPR camera vectors, from its published constants
// (@cornerstonejs/core .../constants/mprCameraValues). Restated here on purpose: the test
// should assert the contract we believe in, so a silent upstream change shows up as a
// failure rather than as agreement with a moved target.
const MPR_CAMERAS = {
  axial: { viewPlaneNormal: [0, 0, -1], viewUp: [0, -1, 0], viewRight: [1, 0, 0] },
  sagittal: { viewPlaneNormal: [1, 0, 0], viewUp: [0, 0, 1], viewRight: [0, 1, 0] },
  coronal: { viewPlaneNormal: [0, -1, 0], viewUp: [0, 0, 1], viewRight: [1, 0, 0] },
} as const;

describe('markersFromCamera', () => {
  it('returns null before the camera exists', () => {
    expect(markersFromCamera({})).toBeNull();
    expect(markersFromCamera({ viewUp: [0, 0, 1] })).toBeNull();
  });

  it('derives the same screen-right vector Cornerstone itself publishes, on every pane', () => {
    // The whole marker system rests on right = viewUp × viewPlaneNormal. If that identity
    // ever breaks, every orientation letter in the viewer is wrong at once.
    for (const [pane, cam] of Object.entries(MPR_CAMERAS)) {
      const r = cross(cam.viewUp, cam.viewPlaneNormal);
      // component-wise: a cross product legitimately yields -0, which toEqual treats as
      // different from 0 even though the vectors are identical.
      r.forEach((c, i) => expect(c, `${pane}[${i}]`).toBeCloseTo(cam.viewRight[i], 12));
    }
  });

  it('labels the axial pane patient-left on screen right (radiological convention)', () => {
    expect(markersFromCamera(MPR_CAMERAS.axial)).toEqual({
      right: 'L',
      left: 'R',
      top: 'A',
      bottom: 'P',
    });
  });

  it('labels the coronal pane patient-left on screen right, superior on top', () => {
    expect(markersFromCamera(MPR_CAMERAS.coronal)).toEqual({
      right: 'L',
      left: 'R',
      top: 'S',
      bottom: 'I',
    });
  });

  it('labels the sagittal pane posterior on screen right, superior on top', () => {
    // Cornerstone's sagittal viewRight is +y, so the patient faces screen-left.
    expect(markersFromCamera(MPR_CAMERAS.sagittal)).toEqual({
      right: 'P',
      left: 'A',
      top: 'S',
      bottom: 'I',
    });
  });

  it('keeps opposite edges opposite on every camera it is given', () => {
    const opposite: Record<string, string> = { L: 'R', R: 'L', A: 'P', P: 'A', S: 'I', I: 'S' };
    const cams = [
      ...Object.values(MPR_CAMERAS),
      { viewUp: normalizeV([0, -0.7, 0.7]), viewPlaneNormal: normalizeV([0.2, 0.6, 0.7]) },
    ];
    for (const cam of cams) {
      const m = markersFromCamera(cam)!;
      expect(m).not.toBeNull();
      expect(opposite[m.right]).toBe(m.left);
      expect(opposite[m.top]).toBe(m.bottom);
    }
  });

  it('follows an oblique roll instead of staying frozen on the orthogonal letters', () => {
    // Roll the coronal camera 80° about its own view normal. Past 45° the top edge has to
    // leave S, which is the whole reason the markers are computed from the live camera.
    const { viewPlaneNormal } = MPR_CAMERAS.coronal;
    const rolled = rotateVec([0, 0, 1], [...viewPlaneNormal], 80);
    const m = markersFromCamera({ viewUp: rolled, viewPlaneNormal })!;
    expect(m.top).not.toBe('S');
    expect(m.top).toBe('R');
    expect(m.bottom).toBe('L');
  });

  it('holds the orthogonal letters for a small roll, below the 45° tipping point', () => {
    const { viewPlaneNormal } = MPR_CAMERAS.coronal;
    const rolled = rotateVec([0, 0, 1], [...viewPlaneNormal], 20);
    expect(markersFromCamera({ viewUp: rolled, viewPlaneNormal })!.top).toBe('S');
  });
});

describe('cross', () => {
  it('follows the right-hand rule on the LPS basis', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(cross([0, 1, 0], [0, 0, 1])).toEqual([1, 0, 0]);
    expect(cross([0, 0, 1], [1, 0, 0])).toEqual([0, 1, 0]);
  });

  it('reverses when the operands swap, which is what a flipped scout looks like', () => {
    expect(cross([0, 1, 0], [1, 0, 0])).toEqual([0, 0, -1]);
  });
});

describe('normalizeV', () => {
  it('returns a unit vector', () => {
    const [x, y, z] = normalizeV([3, 0, 4]);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    expect([x, y, z]).toEqual([0.6, 0, 0.8]);
  });

  it('returns the zero vector unchanged instead of dividing by zero', () => {
    expect(normalizeV([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('rotateVec', () => {
  it('is the identity at 0°', () => {
    const v = normalizeV([0.3, -0.5, 0.8]);
    const r = rotateVec(v, [0, 0, 1], 0);
    r.forEach((c, i) => expect(c).toBeCloseTo(v[i], 12));
  });

  it('turns anterior into patient-left with a 90° rotation about superior', () => {
    // About +z (S), the right-hand rule takes -y (A) to +x (L).
    const r = rotateVec([0, -1, 0], [0, 0, 1], 90);
    expect(r[0]).toBeCloseTo(1, 12);
    expect(r[1]).toBeCloseTo(0, 12);
    expect(r[2]).toBeCloseTo(0, 12);
  });

  it('rotates the opposite way for a negative angle', () => {
    const r = rotateVec([0, -1, 0], [0, 0, 1], -90);
    expect(r[0]).toBeCloseTo(-1, 12);
  });

  it('leaves the rotation axis itself untouched', () => {
    const axis = normalizeV([0.2, 0.5, -0.84]);
    const r = rotateVec([...axis], axis, 137);
    r.forEach((c, i) => expect(c).toBeCloseTo(axis[i], 12));
  });

  it('preserves length', () => {
    const r = rotateVec([0.3, -0.5, 0.8], normalizeV([1, 1, 1]), 47);
    expect(Math.hypot(...r)).toBeCloseTo(Math.hypot(0.3, -0.5, 0.8), 12);
  });

  it('composes: two 45° turns equal one 90° turn', () => {
    const axis: number[] = [0, 0, 1];
    const once = rotateVec([0, -1, 0], axis, 90);
    const twice = rotateVec(rotateVec([0, -1, 0], axis, 45), axis, 45);
    once.forEach((c, i) => expect(c).toBeCloseTo(twice[i], 12));
  });

  it('returns to start after a full 360°', () => {
    const v = [0.3, -0.5, 0.8];
    const r = rotateVec(v, normalizeV([1, 2, 3]), 360);
    r.forEach((c, i) => expect(c).toBeCloseTo(v[i], 10));
  });
});
