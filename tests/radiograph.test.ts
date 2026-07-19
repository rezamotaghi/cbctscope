import { describe, expect, it } from 'vitest';
import { normalizeRadiographFrame, XRAY_MAX } from '../lib/server/radiograph';

const opts = { slope: 1, intercept: 0, monochrome1: false };

describe('normalizeRadiographFrame', () => {
  it('stretches the full input range onto 0..XRAY_MAX', () => {
    const px = Uint16Array.from([100, 300, 500]); // min 100, max 500
    const out = normalizeRadiographFrame(px, opts);
    expect(Array.from(out)).toEqual([0, Math.round(XRAY_MAX / 2), XRAY_MAX]);
  });

  it('applies rescale slope and intercept before stretching', () => {
    const px = Uint16Array.from([0, 10]);
    // slope 2 intercept -5 → values -5, 15 → same stretch as any linear map of them
    const out = normalizeRadiographFrame(px, { slope: 2, intercept: -5, monochrome1: false });
    expect(Array.from(out)).toEqual([0, XRAY_MAX]);
  });

  it('flips MONOCHROME1 to MONOCHROME2 semantics (bright = radiopaque)', () => {
    const px = Uint16Array.from([0, 4095]);
    const out = normalizeRadiographFrame(px, { ...opts, monochrome1: true });
    expect(Array.from(out)).toEqual([XRAY_MAX, 0]);
  });

  it('handles signed input (Int16Array) without wrapping', () => {
    const px = Int16Array.from([-1000, 0, 1000]);
    const out = normalizeRadiographFrame(px, opts);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(XRAY_MAX);
    expect(Math.abs(out[1] - XRAY_MAX / 2)).toBeLessThanOrEqual(1); // float rounding at the exact midpoint
  });

  it('returns all zeros for a constant image instead of dividing by zero', () => {
    const px = Uint16Array.from([7, 7, 7]);
    const out = normalizeRadiographFrame(px, opts);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it('output always stays within 0..XRAY_MAX', () => {
    const px = Uint16Array.from({ length: 512 }, (_, i) => (i * 127) % 65535);
    const out = normalizeRadiographFrame(px, opts);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(XRAY_MAX);
    }
  });
});
