// HU windowing: the robust percentile default window.
import { describe, expect, it } from 'vitest';
import { robustVoi } from '../lib/server/dicom';

describe('robustVoi', () => {
  it('windows a uniform two-level slice across both levels', () => {
    // half air (-1000), half bone (1000) → window spans both
    const n = 70_000;
    const slice = new Int16Array(n);
    for (let i = 0; i < n; i++) slice[i] = i < n / 2 ? -1000 : 1000;
    const { center, width } = robustVoi(slice);
    expect(center).toBeCloseTo(0, -2); // within ~50 of 0
    expect(width).toBeGreaterThan(1800);
  });

  it('ignores extreme outliers via percentiles', () => {
    const n = 70_000;
    const slice = new Int16Array(n).fill(300);
    slice[7] = 32000; // a metal-artifact spike off the stride can't blow the window
    slice[21] = -32000;
    const { width } = robustVoi(slice);
    expect(width).toBeLessThanOrEqual(200); // floor is 100, spikes must not widen it much
  });

  it('enforces a minimum width', () => {
    const slice = new Int16Array(10_000).fill(500);
    const { center, width } = robustVoi(slice);
    expect(width).toBeGreaterThanOrEqual(100);
    expect(center).toBeGreaterThan(400);
  });
});
