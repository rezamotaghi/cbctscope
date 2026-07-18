'use client';
// Nerve / root-canal tracing.
//
// A trace is a 3D polyline in VOLUME mm space (x = patient left+, y = posterior+, z = mm from
// the inferior-most slice). It is deliberately NOT stored in arch coordinates: the arch is a
// viewing device the reader redraws freely, and the canal must survive that. At render time
// each trace point is PROJECTED onto the current arch curve — nearest curve sample → arc
// position s, signed buccolingual offset along the normal, and z — which gives:
//   - the colored polyline on the pano (s → column, z → row);
//   - the crossing dot on every cross-section (interpolated where the path crosses that
//     section's arc position; offset → column, z → row) — the classic clinical presentation;
//   - dim projection dots on the axial arch editor.
import type { ArchCurve, ArchPoint } from './curvedReformat';

export interface NerveTrace {
  id: string;
  name: string;
  /** css color — traces keep their color across every surface */
  color: string;
  kind: 'nerve' | 'root';
  /** [x, y, z] mm in volume space, ordered along the canal */
  points: [number, number, number][];
  visible: boolean;
}

export const TRACE_COLORS = ['#ff5f5f', '#ffb84d', '#59d98c', '#5fb0ff', '#d087ff', '#ffd54a'];

export function newTrace(existing: NerveTrace[], kind: 'nerve' | 'root'): NerveTrace {
  const n = existing.filter((t) => t.kind === kind).length + 1;
  return {
    id: `tr_${Math.random().toString(36).slice(2, 10)}`,
    name: kind === 'nerve' ? `nerve ${n}` : `root canal ${n}`,
    color: TRACE_COLORS[existing.length % TRACE_COLORS.length],
    kind,
    points: [],
    visible: true,
  };
}

/** Nearest curve sample to an in-plane (x, y) mm point. Linear scan — counts are tiny. */
export function nearestCurveIndex(curve: ArchCurve, x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < curve.count; i++) {
    const dx = curve.pts[2 * i] - x;
    const dy = curve.pts[2 * i + 1] - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface ProjectedPoint {
  /** arc position mm along the current curve */
  s: number;
  /** signed buccolingual offset mm from the curve (along its normal) */
  offset: number;
  /** z mm from the inferior-most slice */
  z: number;
}

/** Project every trace point onto the current arch curve. */
export function projectTrace(trace: NerveTrace, curve: ArchCurve): ProjectedPoint[] {
  return trace.points.map(([x, y, z]) => {
    const i = nearestCurveIndex(curve, x, y);
    const dx = x - curve.pts[2 * i];
    const dy = y - curve.pts[2 * i + 1];
    return {
      s: i * curve.step,
      offset: dx * curve.normals[2 * i] + dy * curve.normals[2 * i + 1],
      z,
    };
  });
}

/**
 * Where the projected path crosses arc position sMm (a cross-section's plane): walk the
 * consecutive projected points and linearly interpolate offset + z inside the spanning
 * segment. Null when the trace does not reach this section.
 */
export function sectionCrossing(proj: ProjectedPoint[], sMm: number): { offset: number; z: number } | null {
  if (proj.length === 0) return null;
  if (proj.length === 1) {
    return Math.abs(proj[0].s - sMm) <= 2 ? { offset: proj[0].offset, z: proj[0].z } : null;
  }
  for (let i = 0; i < proj.length - 1; i++) {
    const a = proj[i];
    const b = proj[i + 1];
    const lo = Math.min(a.s, b.s);
    const hi = Math.max(a.s, b.s);
    if (sMm >= lo && sMm <= hi) {
      const f = hi === lo ? 0 : (sMm - a.s) / (b.s - a.s);
      return { offset: a.offset + f * (b.offset - a.offset), z: a.z + f * (b.z - a.z) };
    }
  }
  // just past an endpoint still shows (a canal end sits between two sections)
  const end = proj.reduce((m, p) => (Math.abs(p.s - sMm) < Math.abs(m.s - sMm) ? p : m));
  return Math.abs(end.s - sMm) <= 1.5 ? { offset: end.offset, z: end.z } : null;
}

/** Un-project pano-surface coordinates back to a 3D volume point (on the sampling layer). */
export function panoToVolume(
  curve: ArchCurve,
  sMm: number,
  zMm: number,
  offsetMm: number,
): [number, number, number] {
  const i = Math.max(0, Math.min(curve.count - 1, Math.round(sMm / curve.step)));
  return [
    curve.pts[2 * i] + offsetMm * curve.normals[2 * i],
    curve.pts[2 * i + 1] + offsetMm * curve.normals[2 * i + 1],
    zMm,
  ];
}

/** Insert a point into a trace keeping it ordered along the arch (nerves run along the jaw). */
export function insertOrdered(
  trace: NerveTrace,
  curve: ArchCurve,
  point: [number, number, number],
): NerveTrace {
  const s = nearestCurveIndex(curve, point[0], point[1]) * curve.step;
  const ss = trace.points.map(([x, y]) => nearestCurveIndex(curve, x, y) * curve.step);
  let at = trace.points.length;
  for (let i = 0; i < ss.length; i++) {
    if (s < ss[i]) {
      at = i;
      break;
    }
  }
  const points = [...trace.points];
  points.splice(at, 0, point);
  return { ...trace, points };
}

/** Sidecar payload shape for traces (additive to the evidence schema — old readers ignore it). */
export function sanitizeTraces(raw: unknown): NerveTrace[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is NerveTrace =>
      !!t &&
      typeof (t as NerveTrace).id === 'string' &&
      typeof (t as NerveTrace).name === 'string' &&
      Array.isArray((t as NerveTrace).points) &&
      ((t as NerveTrace).points as unknown[]).every(
        (p) => Array.isArray(p) && p.length === 3 && (p as number[]).every((v) => Number.isFinite(v)),
      ),
  );
}

export type { ArchPoint };
