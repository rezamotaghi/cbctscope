// Pano arch-spline reformat math: Catmull-Rom fit + uniform arc-length resample.
import { describe, expect, it } from 'vitest';
import { buildArchCurve, type ArchPoint } from '../components/cbct/curvedReformat';

describe('buildArchCurve', () => {
  it('returns null for fewer than 3 control points or a too-short curve', () => {
    expect(buildArchCurve([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0.5)).toBeNull();
    expect(
      buildArchCurve([{ x: 0, y: 0 }, { x: 0.2, y: 0 }, { x: 0.4, y: 0 }], 0.5),
    ).toBeNull();
  });

  it('recovers the length of a straight line and samples it uniformly', () => {
    const pts: ArchPoint[] = [
      { x: 0, y: 0 },
      { x: 25, y: 0 },
      { x: 50, y: 0 },
    ];
    const curve = buildArchCurve(pts, 0.5);
    expect(curve).not.toBeNull();
    // arc length of a straight polyline through collinear points = end-to-end distance
    expect(curve!.length).toBeCloseTo(50, 0);
    // uniform resampling: consecutive samples are `step` apart
    for (let i = 1; i < Math.min(curve!.count, 40); i++) {
      const dx = curve!.pts[2 * i] - curve!.pts[2 * i - 2];
      const dy = curve!.pts[2 * i + 1] - curve!.pts[2 * i - 1];
      expect(Math.hypot(dx, dy)).toBeCloseTo(0.5, 1);
    }
  });

  it('approximates a semicircle arc length within 2%', () => {
    const r = 30;
    const pts: ArchPoint[] = [];
    for (let a = 0; a <= 8; a++) {
      const th = (Math.PI * a) / 8;
      pts.push({ x: r * Math.cos(th), y: r * Math.sin(th) });
    }
    const curve = buildArchCurve(pts, 0.25);
    expect(curve).not.toBeNull();
    expect(Math.abs(curve!.length - Math.PI * r) / (Math.PI * r)).toBeLessThan(0.02);
  });

  it('produces unit normals perpendicular to the local tangent', () => {
    const pts: ArchPoint[] = [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
      { x: 40, y: 0 },
    ];
    const curve = buildArchCurve(pts, 0.5)!;
    for (let i = 1; i < curve.count - 1; i++) {
      const nx = curve.normals[2 * i];
      const ny = curve.normals[2 * i + 1];
      expect(Math.hypot(nx, ny)).toBeCloseTo(1, 3);
      const tx = curve.pts[2 * (i + 1)] - curve.pts[2 * (i - 1)];
      const ty = curve.pts[2 * (i + 1) + 1] - curve.pts[2 * (i - 1) + 1];
      const t = Math.hypot(tx, ty) || 1;
      expect(Math.abs((nx * tx + ny * ty) / t)).toBeLessThan(0.05);
    }
  });
});
