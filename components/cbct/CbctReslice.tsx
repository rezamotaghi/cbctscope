'use client';
// Volume reslicer: generate a fresh 2D slice STACK along any
// path the reader draws on the axial scout — a straight line at any angle, or a curved arc.
// Two output shapes:
//   - CROSS: planes perpendicular to the path, marched along it (serial cross-sections — the
//     "walk down this line and cut across it" read);
//   - PARALLEL: planes containing the path direction, offset sideways (a stack of parallel
//     reformats — "slices along this chosen direction").
// Count / distance / width / thickness / vertical-range controls; the whole stack saves to one
// PNG. Pure canvas off the shared HU cache, reusing the curved-reformat primitives.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadVolumeData, type CbctMeta, type VolumeEntry } from './volumeData';
import {
  axialSlice,
  drawImage,
  buildArchCurve,
  renderSection,
  renderPano,
  renderLineSection,
  type ArchPoint,
  type ZRange,
} from './curvedReformat';
import DragDivider from './DragDivider';
import { sweepDeg } from './CbctGrid';
import { VertRangeSliders } from './CbctPano';
import { renderOblique, type V3 } from './oblique';

interface Props {
  anon: string;
  voi: { center: number; width: number } | null;
  invert: boolean;
  onMeta?: (meta: CbctMeta) => void;
  onError?: (msg: string) => void;
}

const RESLICE_KEY = (anon: string) => `cbctscope-reslice:v1:${anon}`;
// same MPR-vibrancy palette as the pano view (2026-07-29)
const ACCENT = 'rgba(85,150,255,0.95)';
const MARKER = 'rgba(235,205,45,0.95)';
const MARKER_DIM = 'rgba(235,205,45,0.5)';
const SLAB_GUIDE = 'rgba(70,220,95,0.95)'; // sampled-band outline, green like the pano's

interface Persisted {
  points: ArchPoint[];
  z: number;
  /** true once the path was FINISHED (double-click / freehand) — clicks are then inert,
   *  dots drag, the path drags as a whole (the pano arch lifecycle, path edition). */
  done?: boolean;
  /** the path as of its last finish — "Reset path" returns here after drags */
  home?: { points: ArchPoint[]; z: number };
}

function loadPersisted(anon: string): Persisted | null {
  try {
    const raw = localStorage.getItem(RESLICE_KEY(anon));
    if (!raw) return null;
    const p = JSON.parse(raw) as Persisted;
    return Array.isArray(p.points) && p.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)) ? p : null;
  } catch {
    return null;
  }
}

function containPos(cv: HTMLCanvasElement, e: { clientX: number; clientY: number }): { x: number; y: number } | null {
  const r = cv.getBoundingClientRect();
  if (!cv.width || !cv.height || !r.width || !r.height) return null;
  const scale = Math.min(r.width / cv.width, r.height / cv.height);
  const ox = r.left + (r.width - cv.width * scale) / 2;
  const oy = r.top + (r.height - cv.height * scale) / 2;
  const x = (e.clientX - ox) / scale;
  const y = (e.clientY - oy) / scale;
  if (x < 0 || y < 0 || x > cv.width || y > cv.height) return null;
  return { x, y };
}

/** Uniformly resample a freehand stroke (mm) down to a few control points. */
function simplifyStroke(stroke: ArchPoint[]): ArchPoint[] {
  if (stroke.length < 2) return stroke;
  const cum = [0];
  for (let i = 1; i < stroke.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y));
  }
  const total = cum[cum.length - 1];
  const k = Math.max(2, Math.min(13, Math.round(total / 11)));
  const out: ArchPoint[] = [];
  let seg = 0;
  for (let i = 0; i < k; i++) {
    const s = (i / (k - 1)) * total;
    while (seg < stroke.length - 2 && cum[seg + 1] < s) seg++;
    const span = cum[seg + 1] - cum[seg] || 1;
    const f = (s - cum[seg]) / span;
    out.push({
      x: stroke[seg].x + f * (stroke[seg + 1].x - stroke[seg].x),
      y: stroke[seg].y + f * (stroke[seg + 1].y - stroke[seg].y),
    });
  }
  return out;
}

/** One output slice's cutting geometry in mm: center + in-plane column direction. */
interface SliceGeom {
  cx: number;
  cy: number;
  dirX: number;
  dirY: number;
  label: string;
}

export default function CbctReslice({ anon, voi, invert, onMeta, onError }: Props) {
  const [entry, setEntry] = useState<VolumeEntry | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [points, setPoints] = useState<ArchPoint[]>([]);
  const [stroke, setStroke] = useState<ArchPoint[] | null>(null);
  const [z, setZ] = useState(0);
  const [outMode, setOutMode] = useState<'cross' | 'parallel'>('cross');
  const [count, setCount] = useState(9);
  const [distance, setDistance] = useState(3);
  const [width, setWidth] = useState(30);
  const [thickness, setThickness] = useState(0.5);
  const [mip, setMip] = useState(false);
  const [zFrac, setZFrac] = useState<[number, number]>([0, 1]);
  const [hoverIdx, setHoverIdx] = useState(-1);
  // path lifecycle (the pano arch model): PLACING until a double-click / freehand finish,
  // then FINISHED — clicks inert, dots drag, the line drags as a whole; home = last finish
  const [pathDone, setPathDone] = useState(false);
  const [pathHome, setPathHome] = useState<{ points: ArchPoint[]; z: number } | null>(null);
  const [hoverLine, setHoverLine] = useState(false);
  // shared in-plane tilt of the stack (the MPR/grid right-drag) + the draggable pane split
  const [tilt, setTilt] = useState(0);
  const tilted = Math.abs(tilt) > 0.01;
  const [rotChip, setRotChip] = useState<string | null>(null);
  const [leftFrac, setLeftFrac] = useState(0.34);

  const axialCv = useRef<HTMLCanvasElement | null>(null);
  const sliceCvs = useRef<(HTMLCanvasElement | null)[]>([]);
  const dragIdx = useRef(-1);
  const dragAllRef = useRef<ArchPoint | null>(null); // whole-path drag: last pointer pos (mm)
  const lastAppendRef = useRef(0); // when the last click-appended dot landed (stray-pop on dbl)
  const rotRef = useRef<{ lastX: number; lastY: number; px: number; py: number; totalDeg: number; tilt0: number } | null>(null);
  const rotConsumedRef = useRef(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const strokeRef = useRef<ArchPoint[] | null>(null);

  useEffect(() => {
    let stale = false;
    setEntry(null);
    setProgress(0);
    setPoints([]);
    setStroke(null);
    setTilt(0); // a tilt belongs to the volume it was set on
    loadVolumeData(anon, (f) => !stale && setProgress(Math.min(0.95, f)))
      .then((e) => {
        if (stale) return;
        setEntry(e);
        onMeta?.(e.meta);
        const saved = loadPersisted(anon);
        const savedPts = saved?.points ?? [];
        const savedZ = saved?.z ?? Math.round(e.meta.dims[2] * 0.5);
        const savedDone = saved?.done ?? savedPts.length >= 2; // pre-`done` saves: a full path was finished
        setPoints(savedPts);
        setZ(savedZ);
        setPathDone(savedDone);
        setPathHome(saved?.home ?? (savedDone && savedPts.length >= 2 ? { points: savedPts, z: savedZ } : null));
        setProgress(null);
      })
      .catch((err) => {
        console.error('[cbct-reslice] load failed', err);
        if (!stale) {
          setProgress(null);
          onError?.('volume load failed — see console');
        }
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anon]);

  useEffect(() => {
    if (!entry) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          RESLICE_KEY(anon),
          JSON.stringify({ points, z, done: pathDone, home: pathHome ?? undefined }),
        );
      } catch {
        /* storage full */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [points, z, pathDone, pathHome, anon, entry]);

  const effVoi = useMemo(() => voi ?? entry?.meta.defaultVoi ?? { center: 300, width: 2500 }, [voi, entry]);
  const dims = useMemo(() => entry?.meta.dims ?? ([1, 1, 1] as [number, number, number]), [entry]);
  const spacing = useMemo(() => entry?.meta.spacing ?? ([0.2, 0.2, 0.2] as [number, number, number]), [entry]);
  const sx = spacing[0];
  const sy = spacing[1];
  const slices = dims[2];

  const zRange = useMemo<ZRange>(() => {
    const zLo = Math.round(zFrac[0] * (slices - 1));
    const zHi = Math.max(zLo + 3, Math.round(zFrac[1] * (slices - 1)));
    return { zLo, zHi: Math.min(slices - 1, zHi) };
  }, [zFrac, slices]);

  const isCurved = points.length >= 3;
  const curve = useMemo(
    () => (entry && isCurved ? buildArchCurve(points, Math.max(sx, 0.1)) : null),
    [entry, isCurved, points, sx],
  );

  // straight-line geometry (exactly 2 points): direction + normal
  const line = useMemo(() => {
    if (points.length !== 2) return null;
    const a = points[0];
    const b = points[1];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) return null;
    dx /= len;
    dy /= len;
    return { a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dir: { x: dx, y: dy }, nrm: { x: -dy, y: dx }, len };
  }, [points]);

  const hasPath = !!curve || !!line;

  // per-slice cutting geometry, centered on the path midpoint
  const sliceGeoms = useMemo<SliceGeom[]>(() => {
    const geoms: SliceGeom[] = [];
    for (let i = 0; i < count; i++) {
      const off = (i - (count - 1) / 2) * distance;
      if (line) {
        if (outMode === 'cross') {
          // perpendicular planes marching along the line — columns span the normal
          geoms.push({
            cx: line.mid.x + line.dir.x * off,
            cy: line.mid.y + line.dir.y * off,
            dirX: line.nrm.x,
            dirY: line.nrm.y,
            label: `${off > 0 ? '+' : ''}${off.toFixed(1)} mm`,
          });
        } else {
          // parallel planes offset sideways — columns run along the line direction
          geoms.push({
            cx: line.mid.x + line.nrm.x * off,
            cy: line.mid.y + line.nrm.y * off,
            dirX: line.dir.x,
            dirY: line.dir.y,
            label: `${off > 0 ? '+' : ''}${off.toFixed(1)} mm`,
          });
        }
      }
    }
    return geoms;
  }, [count, distance, line, outMode]);

  // the stack's image-horizontal 3D direction (xy, mm) + its center — the tilt axis frame
  const stackFrame = useMemo(() => {
    if (line) {
      return {
        hx: outMode === 'cross' ? line.nrm.x : line.dir.x,
        hy: outMode === 'cross' ? line.nrm.y : line.dir.y,
        cx: line.mid.x,
        cy: line.mid.y,
      };
    }
    if (curve) {
      const ci = Math.max(0, Math.min(curve.count - 1, Math.round(curve.length / 2 / curve.step)));
      const nx = curve.normals[2 * ci];
      const ny = curve.normals[2 * ci + 1];
      return {
        hx: outMode === 'cross' ? nx : ny, // parallel: the tangent (normal rotated −90°)
        hy: outMode === 'cross' ? ny : -nx,
        cx: curve.pts[2 * ci],
        cy: curve.pts[2 * ci + 1],
      };
    }
    return null;
  }, [line, curve, outMode]);

  // ---- draw axial scout: slice + path + stack markers (oblique re-cut while tilted)
  useEffect(() => {
    const cv = axialCv.current;
    if (!cv || !entry) return;
    if (tilted && stackFrame) {
      // Rigid frame, reslice edition: the scout re-cuts ⊥ the tilted stack axis, rotated
      // about the stack's image-horizontal direction at the path center (renderOblique —
      // the shared grid/TMJ/reslice sampler). Path editing pauses; the path itself stays
      // visible as a projection (its vertical curtain ∩ this plane), dashed + dimmed.
      const th = (tilt * Math.PI) / 180;
      const norm = (vec: V3): V3 => {
        const L = Math.hypot(vec[0], vec[1], vec[2]) || 1;
        return [vec[0] / L, vec[1] / L, vec[2] / L];
      };
      const H = norm([stackFrame.hx / sx, stackFrame.hy / sy, 0]);
      const U = norm([-Math.sin(th) * H[0], -Math.sin(th) * H[1], Math.cos(th)]);
      const seed: V3 = Math.abs(U[0]) > 0.94 ? [0, 1, 0] : [1, 0, 0];
      const dotSU = seed[0] * U[0] + seed[1] * U[1] + seed[2] * U[2];
      const u = norm([seed[0] - dotSU * U[0], seed[1] - dotSU * U[1], seed[2] - dotSU * U[2]]);
      const v: V3 = [
        U[1] * u[2] - U[2] * u[1],
        U[2] * u[0] - U[0] * u[2],
        U[0] * u[1] - U[1] * u[0],
      ];
      const C0 = dims[0] / 2;
      const C1 = dims[1] / 2;
      const C2 = dims[2] / 2;
      const P: V3 = [stackFrame.cx / sx, stackFrame.cy / sy, z];
      const off = (P[0] - C0) * U[0] + (P[1] - C1) * U[1] + (P[2] - C2) * U[2];
      const idata = renderOblique(
        entry,
        { u, v, n: U },
        off,
        1,
        false,
        effVoi.center - effVoi.width / 2,
        effVoi.center + effVoi.width / 2,
        invert,
        1,
      );
      cv.width = idata.width;
      cv.height = idata.height;
      const octx = cv.getContext('2d')!;
      octx.putImageData(idata, 0, 0);
      const toImg = (qx: number, qy: number, qz: number): [number, number] => [
        (qx - C0) * u[0] + (qy - C1) * u[1] + (qz - C2) * u[2] + idata.width / 2,
        (qx - C0) * v[0] + (qy - C1) * v[1] + (qz - C2) * v[2] + idata.height / 2,
      ];
      const curtainZ = (qx: number, qy: number) => C2 + (off - (qx - C0) * U[0] - (qy - C1) * U[1]) / U[2];
      octx.globalAlpha = 0.55;
      octx.strokeStyle = ACCENT;
      octx.lineWidth = 1.5;
      octx.setLineDash([7, 5]);
      octx.beginPath();
      const pathPts: [number, number][] = curve
        ? Array.from({ length: curve.count }, (_, i) => [curve.pts[2 * i] / sx, curve.pts[2 * i + 1] / sy])
        : points.map((p) => [p.x / sx, p.y / sy] as [number, number]);
      pathPts.forEach(([qx, qy], i) => {
        const [ix, iy] = toImg(qx, qy, curtainZ(qx, qy));
        if (i === 0) octx.moveTo(ix, iy);
        else octx.lineTo(ix, iy);
      });
      octx.stroke();
      octx.setLineDash([]);
      for (const p of points) {
        const qx = p.x / sx;
        const qy = p.y / sy;
        const [ix, iy] = toImg(qx, qy, curtainZ(qx, qy));
        octx.fillStyle = ACCENT;
        octx.beginPath();
        octx.arc(ix, iy, 3, 0, Math.PI * 2);
        octx.fill();
      }
      octx.globalAlpha = 1;
      return;
    }
    const img = axialSlice(entry, z);
    drawImage(cv, img, effVoi, invert);
    const ctx = cv.getContext('2d')!;
    const toPx = (p: { x: number; y: number }): [number, number] => [p.x / img.pxW, p.y / img.pxH];
    if (stroke && stroke.length > 1) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      stroke.forEach((p, i) => {
        const [x, y] = toPx(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      return;
    }
    // the path
    if (curve) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < curve.count; i++) {
        const x = curve.pts[2 * i] / img.pxW;
        const y = curve.pts[2 * i + 1] / img.pxH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else if (line) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.6;
      const [ax, ay] = toPx(line.a);
      const [bx, by] = toPx(line.b);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    // sampled-band outline (the pano slab-guide, reslice edition): a closed green shape
    // around exactly what the stack cuts — live against count/distance/width/thickness
    if (hasPath) {
      ctx.strokeStyle = SLAB_GUIDE;
      ctx.lineWidth = 1;
      const span = (count - 1) * distance + thickness;
      if (line) {
        // both line modes are a rectangle: columns axis × stack axis (swapped by mode)
        const colX = outMode === 'cross' ? line.nrm.x : line.dir.x;
        const colY = outMode === 'cross' ? line.nrm.y : line.dir.y;
        const stkX = outMode === 'cross' ? line.dir.x : line.nrm.x;
        const stkY = outMode === 'cross' ? line.dir.y : line.nrm.y;
        const hw = width / 2;
        const hs = span / 2;
        const corner = (a: number, b2: number): [number, number] => [
          (line.mid.x + colX * a + stkX * b2) / img.pxW,
          (line.mid.y + colY * a + stkY * b2) / img.pxH,
        ];
        const cs: [number, number][] = [corner(-hw, -hs), corner(hw, -hs), corner(hw, hs), corner(-hw, hs)];
        ctx.beginPath();
        cs.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.closePath();
        ctx.stroke();
      } else if (curve) {
        if (outMode === 'cross') {
          // marched span along the arc × width across it — offset-curve segment + caps
          const sMid = curve.length / 2;
          const iLo = Math.max(0, Math.round((sMid - span / 2) / curve.step));
          const iHi = Math.min(curve.count - 1, Math.round((sMid + span / 2) / curve.step));
          const hw = width / 2;
          const pt = (i: number, side: number): [number, number] => [
            (curve.pts[2 * i] + curve.normals[2 * i] * side * hw) / img.pxW,
            (curve.pts[2 * i + 1] + curve.normals[2 * i + 1] * side * hw) / img.pxH,
          ];
          ctx.beginPath();
          for (let i = iLo; i <= iHi; i++) {
            const [x, y] = pt(i, 1);
            if (i === iLo) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          for (let i = iHi; i >= iLo; i--) {
            const [x, y] = pt(i, -1);
            ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        } else {
          // parallel curved reformats: the pano-style band around the whole curve
          const hb = ((count - 1) / 2) * distance + Math.max(2, thickness || 2) / 2;
          const pt = (i: number, side: number): [number, number] => [
            (curve.pts[2 * i] + curve.normals[2 * i] * side * hb) / img.pxW,
            (curve.pts[2 * i + 1] + curve.normals[2 * i + 1] * side * hb) / img.pxH,
          ];
          ctx.beginPath();
          for (let i = 0; i < curve.count; i++) {
            const [x, y] = pt(i, 1);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          for (let i = curve.count - 1; i >= 0; i--) {
            const [x, y] = pt(i, -1);
            ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    }
    // stack markers
    if (line) {
      sliceGeoms.forEach((g, i) => {
        const cx = g.cx / img.pxW;
        const cy = g.cy / img.pxH;
        const half = (outMode === 'cross' ? width * 0.4 : line.len * 0.55) / img.pxW;
        const tx = g.dirX * half;
        const ty = g.dirY * half;
        const mid = i === (count - 1) / 2;
        ctx.strokeStyle = mid ? MARKER : MARKER_DIM;
        ctx.lineWidth = mid ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(cx - tx, cy - ty);
        ctx.lineTo(cx + tx, cy + ty);
        ctx.stroke();
        ctx.fillStyle = mid ? MARKER : MARKER_DIM;
        ctx.font = '10px sans-serif';
        ctx.fillText(String(i + 1), cx + tx + 2, cy + ty + 2);
      });
    } else if (curve) {
      // cross-sections stepped along the curve, centered on mid-arc
      for (let i = 0; i < count; i++) {
        const off = (i - (count - 1) / 2) * distance;
        const s = Math.max(0, Math.min(curve.length, curve.length / 2 + off));
        const ci = Math.max(0, Math.min(curve.count - 1, Math.round(s / curve.step)));
        const cx = curve.pts[2 * ci] / img.pxW;
        const cy = curve.pts[2 * ci + 1] / img.pxH;
        const half = (width * 0.4) / img.pxW;
        const nx = curve.normals[2 * ci] * half;
        const ny = curve.normals[2 * ci + 1] * half;
        const mid = i === (count - 1) / 2;
        ctx.strokeStyle = mid ? MARKER : MARKER_DIM;
        ctx.lineWidth = mid ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(cx - nx, cy - ny);
        ctx.lineTo(cx + nx, cy + ny);
        ctx.stroke();
        ctx.fillStyle = mid ? MARKER : MARKER_DIM;
        ctx.font = '10px sans-serif';
        ctx.fillText(String(i + 1), cx + nx + 2, cy + ny + 2);
      }
    }
    // control-point dots
    points.forEach((p, i) => {
      const [x, y] = toPx(p);
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(x, y, i === hoverIdx ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      if (i === hoverIdx) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  }, [entry, z, effVoi, invert, curve, line, points, stroke, sliceGeoms, count, distance, width, thickness, outMode, hoverIdx, tilted, tilt, hasPath, stackFrame, dims, sx, sy, spacing]);

  // ---- draw the output stack
  useEffect(() => {
    if (!entry || !hasPath) return;
    for (let i = 0; i < count; i++) {
      const cv = sliceCvs.current[i];
      if (!cv) continue;
      let img;
      if (line) {
        const g = sliceGeoms[i];
        img = renderLineSection(entry, g.cx, g.cy, g.dirX, g.dirY, width, { thicknessMm: thickness, range: zRange, mip, tiltDeg: tilt });
      } else if (curve) {
        const off = (i - (count - 1) / 2) * distance;
        if (outMode === 'cross') {
          const s = Math.max(0, Math.min(curve.length, curve.length / 2 + off));
          img = renderSection(entry, curve, s, width, { thicknessMm: thickness, range: zRange, tiltDeg: tilt });
        } else {
          // parallel curved reformats = the arch swept at a buccolingual shift
          img = renderPano(entry, curve, Math.max(2, thickness || 2), mip, { shiftMm: off, range: zRange, tiltDeg: tilt });
        }
      }
      if (img) {
        drawImage(cv, img, effVoi, invert);
        const ctx = cv.getContext('2d')!;
        ctx.fillStyle = i === (count - 1) / 2 ? MARKER : '#9aa3b2';
        ctx.font = '10px sans-serif';
        const off = (i - (count - 1) / 2) * distance;
        ctx.fillText(`${i + 1} · ${off > 0 ? '+' : ''}${off.toFixed(1)} mm`, 4, 11);
      }
    }
  }, [entry, hasPath, line, curve, sliceGeoms, count, distance, width, thickness, mip, outMode, zRange, effVoi, invert, tilt]);

  // ---- stack rotation: the MPR/grid right-drag on any tile spins the whole stack in-plane
  const onTileDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasPath || e.button !== 2) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    rotRef.current = {
      lastX: e.clientX,
      lastY: e.clientY,
      px: r.left + r.width / 2,
      py: r.top + r.height / 2,
      totalDeg: 0,
      tilt0: tilt,
    };
    rotConsumedRef.current = false;
    setRotChip(`tilt ${tilt >= 0 ? '+' : ''}${tilt.toFixed(0)}°`);
  };
  const onTileMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rot = rotRef.current;
    if (!rot) return;
    const deg = sweepDeg(rot.px, rot.py, rot.lastX, rot.lastY, e.clientX, e.clientY);
    rot.lastX = e.clientX;
    rot.lastY = e.clientY;
    if (!deg) return;
    rot.totalDeg += deg;
    if (Math.abs(rot.totalDeg) > 1.5) rotConsumedRef.current = true;
    const next = rot.tilt0 + rot.totalDeg;
    setTilt(next);
    setRotChip(`tilt ${next >= 0 ? '+' : ''}${next.toFixed(0)}°`);
  };
  const onTileUp = () => {
    if (rotRef.current) {
      rotRef.current = null;
      setRotChip(null);
    }
  };

  // ---- axial interactions: freehand OR click points; drag; wheel = slice
  const axialPos = useCallback(
    (e: { clientX: number; clientY: number }): ArchPoint | null => {
      const cv = axialCv.current;
      if (!cv || !entry) return null;
      const p = containPos(cv, e);
      return p ? { x: p.x * sx, y: p.y * sy } : null;
    },
    [entry, sx, sy],
  );
  const hitPoint = useCallback(
    (p: ArchPoint): number => {
      let best = -1;
      let bestD = 8 * sx;
      points.forEach((q, i) => {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    },
    [points, sx],
  );

  // distance test against the drawn path (curve samples, or the straight segment) — the
  // whole-path grab handle once finished
  const hitPath = useCallback(
    (p: ArchPoint): boolean => {
      const thresh = 8 * sx;
      if (curve) {
        for (let i = 0; i < curve.count; i++) {
          if (Math.hypot(curve.pts[2 * i] - p.x, curve.pts[2 * i + 1] - p.y) < thresh) return true;
        }
        return false;
      }
      if (line) {
        const vx = line.b.x - line.a.x;
        const vy = line.b.y - line.a.y;
        const t = Math.max(0, Math.min(1, ((p.x - line.a.x) * vx + (p.y - line.a.y) * vy) / (vx * vx + vy * vy)));
        return Math.hypot(line.a.x + t * vx - p.x, line.a.y + t * vy - p.y) < thresh;
      }
      return false;
    },
    [curve, line, sx],
  );

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    if (tilted) return; // oblique scout — path editing pauses until upright
    const p = axialPos(e);
    if (!p) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const hit = hitPoint(p);
    if (hit >= 0) {
      dragIdx.current = hit;
    } else if (pathDone) {
      if (hitPath(p)) dragAllRef.current = p; // finished path: the line drags as a whole
    } else {
      strokeRef.current = [p];
      setStroke([p]);
    }
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tilted) return;
    if (dragIdx.current >= 0) {
      const p = axialPos(e);
      if (p) setPoints((pts) => pts.map((q, i) => (i === dragIdx.current ? p : q)));
      return;
    }
    if (dragAllRef.current) {
      const p = axialPos(e);
      if (p) {
        const dx = p.x - dragAllRef.current.x;
        const dy = p.y - dragAllRef.current.y;
        if (dx || dy) {
          setPoints((pts) => pts.map((q) => ({ x: q.x + dx, y: q.y + dy })));
          dragAllRef.current = p;
        }
      }
      return;
    }
    const st = strokeRef.current;
    if (st) {
      const p = axialPos(e);
      if (!p) return;
      const last = st[st.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > sx * 2) {
        st.push(p);
        setStroke([...st]);
      }
      return;
    }
    const p = axialPos(e);
    const dot = p ? hitPoint(p) : -1;
    setHoverIdx(dot);
    setHoverLine(pathDone && dot < 0 && !!p && hitPath(p));
  };
  const onUp = () => {
    dragIdx.current = -1;
    dragAllRef.current = null;
    const st = strokeRef.current;
    strokeRef.current = null;
    setStroke(null);
    if (!st) return;
    const len = st.reduce((a, p, i) => (i ? a + Math.hypot(p.x - st[i - 1].x, p.y - st[i - 1].y) : 0), 0);
    if (len > 12) {
      const drawn = simplifyStroke(st);
      setPoints(drawn); // a stroke REPLACES the path — and IS a complete one
      setPathDone(true);
      if (drawn.length >= 2) setPathHome({ points: drawn, z });
    } else {
      setPoints((pts) => [...pts, st[0]]); // a click appends a control point
      lastAppendRef.current = performance.now();
    }
  };
  const onDbl = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tilted) return;
    const p = axialPos(e);
    if (!p) return;
    const hit = hitPoint(p);
    if (pathDone) {
      if (hit >= 0) deleteAt(e); // finished: dbl-click still deletes the dot under the cursor
      return;
    }
    // placing: double-click FINISHES (its own first click appended a stray dot — pop if fresh)
    const strayFresh = hit >= 0 && hit === points.length - 1 && performance.now() - lastAppendRef.current < 600;
    if (hit >= 0 && !strayFresh) {
      deleteAt(e);
      return;
    }
    const kept = strayFresh ? points.slice(0, -1) : points;
    if (strayFresh) setPoints(kept);
    if (kept.length >= 2) {
      setPathDone(true); // 2 = line, ≥3 = arc
      setPathHome({ points: kept, z });
    }
  };
  const deleteAt = (e: { clientX: number; clientY: number }) => {
    const p = axialPos(e);
    if (!p) return;
    const hit = hitPoint(p);
    if (hit >= 0) {
      setPoints((pts) => {
        const next = pts.filter((_, i) => i !== hit);
        if (next.length < 2) setPathDone(false); // no path left to be "finished"
        return next;
      });
      setHoverIdx(-1);
    }
  };
  const onContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (tilted) return;
    deleteAt(e);
  };
  useEffect(() => {
    const cv = axialCv.current;
    if (!cv || !entry) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZ((v) => Math.max(0, Math.min(entry.meta.dims[2] - 1, v + (e.deltaY > 0 ? 1 : -1))));
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [entry]);

  // ---- save the stack to one PNG
  const saveStack = useCallback(() => {
    const canvases = sliceCvs.current.slice(0, count).filter(Boolean) as HTMLCanvasElement[];
    if (!canvases.length) return;
    const gap = 4;
    const cols = Math.ceil(Math.sqrt(canvases.length));
    const rows = Math.ceil(canvases.length / cols);
    const tw = Math.max(...canvases.map((c) => c.width));
    const th = Math.max(...canvases.map((c) => c.height));
    const out = document.createElement('canvas');
    out.width = cols * tw + (cols - 1) * gap;
    out.height = rows * th + (rows - 1) * gap + 22;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, out.width, out.height);
    canvases.forEach((c, i) => {
      const x = (i % cols) * (tw + gap);
      const y = Math.floor(i / cols) * (th + gap);
      ctx.drawImage(c, x + (tw - c.width) / 2, y);
    });
    ctx.fillStyle = '#aeb6c6';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    const kind = curve ? (outMode === 'cross' ? 'curved cross-sections' : 'curved reformats') : outMode === 'cross' ? 'line cross-sections' : 'parallel reslices';
    ctx.fillText(`${anon} · reslice · ${count} × ${kind} · ${distance} mm apart · ${new Date().toISOString().slice(0, 10)}`, 6, out.height - 5);
    try {
      const url = out.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${anon}_reslice_${outMode}.png`;
      a.click();
    } catch {
      onError?.('snapshot failed');
    }
  }, [count, curve, outMode, distance, anon, onError]);

  const small: React.CSSProperties = { fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' };
  const sliderRow: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', padding: '4px 2px', flexWrap: 'wrap' };
  const chip = (active: boolean): React.CSSProperties => ({
    padding: '3px 8px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent-dim)' : 'var(--panel-2)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: 11,
  });

  // grid layout for the output tiles
  const gcols = Math.ceil(Math.sqrt(count));
  const grows = Math.ceil(count / gcols);

  return (
    <div
      ref={gridRef}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: `minmax(240px, ${(leftFrac * 100).toFixed(1)}%) 6px 1fr`,
        gap: 6,
        width: '100%',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* left: axial path editor + controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
          <canvas
            ref={axialCv}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={() => setHoverIdx(-1)}
            onDoubleClick={onDbl}
            onContextMenu={onContext}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              cursor: hoverIdx >= 0 || hoverLine ? 'grab' : tilted ? 'default' : pathDone ? 'default' : 'crosshair',
              touchAction: 'none',
              display: 'block',
            }}
          />
          <span style={{ position: 'absolute', top: 6, left: 8, ...small, pointerEvents: 'none' }}>
            {tilted
              ? `OBLIQUE ${tilt >= 0 ? '+' : ''}${tilt.toFixed(0)}° · scout ⊥ the tilted stack axis · path shown as projection · press upright to edit`
              : `AXIAL ${entry ? `${z + 1}/${slices}` : ''} · ${
                  pathDone
                    ? 'path finished — drag a dot to refine · drag the line to move the whole path'
                    : 'drag a line (2 pts) or curve (≥3) · click = add · double-click = finish'
                }`}
          </span>
          <input
            className="vslice"
            type="range"
            min={0}
            max={Math.max(0, slices - 1)}
            step={1}
            value={z}
            onChange={(e) => setZ(Number(e.target.value))}
            onPointerDown={(e) => e.stopPropagation()}
            title="scout slice · up = superior (S)"
            style={{ position: 'absolute', right: 2, top: 26, bottom: 26, width: 20, height: 'auto', writingMode: 'vertical-lr', direction: 'rtl', zIndex: 1 }}
          />
        </div>
        <div style={sliderRow}>
          <button style={chip(outMode === 'cross')} title="planes PERPENDICULAR to the path, marched along it (serial cross-sections)" onClick={() => setOutMode('cross')}>
            ⊥ cross
          </button>
          <button style={chip(outMode === 'parallel')} title="planes CONTAINING the path direction, offset sideways (a parallel stack)" onClick={() => setOutMode('parallel')}>
            ∥ parallel
          </button>
          <button
            style={chip(false)}
            disabled={!points.length}
            title="delete the drawn path — back to placing"
            onClick={() => {
              setPoints([]);
              setPathDone(false);
              setPathHome(null);
              setTilt(0); // the tilt belonged to the frame the path defined
            }}
          >
            clear path
          </button>
          <button
            style={{ ...chip(false), color: !pathHome ? 'var(--text-dim)' : 'var(--text)', cursor: !pathHome ? 'default' : 'pointer' }}
            disabled={!pathHome}
            title="put the path back to its main position (as of the last finish) — undoes dot drags and whole-path drags"
            onClick={() => {
              if (!pathHome || pathHome.points.length < 2) return;
              setPoints(pathHome.points.map((p) => ({ ...p })));
              setZ(pathHome.z);
              setPathDone(true);
            }}
          >
            Reset path
          </button>
          <button style={chip(false)} disabled={!hasPath} title="save the whole stack as one PNG" onClick={saveStack}>
            💾 save stack
          </button>
          <span style={small}>{isCurved ? 'curved arc' : line ? 'straight line' : `${points.length}/2 points`}</span>
        </div>
        <div style={sliderRow}>
          <span style={small} title="the vertical crop moved to the handles on the stack's right edge (pano-style)">
            vertical range {Math.round(zFrac[0] * 100)}–{Math.round(zFrac[1] * 100)}% (handles right of the stack)
          </span>
          <button
            style={chip(false)}
            disabled={!entry}
            title="reset the reading position — tilt upright + full vertical range (path, stack params, and pane split untouched)"
            onClick={() => {
              setTilt(0);
              setZFrac([0, 1]);
            }}
          >
            reset position
          </button>
        </div>
        <div style={{ ...small, whiteSpace: 'normal', lineHeight: 1.5 }}>
          Draw ANY line or arc on the scout and get a fresh slice stack cut against it — a road
          through the volume no orthogonal plane gives you. ⊥ cross walks the path cutting
          across it; ∥ parallel stacks slices along it.
        </div>
      </div>

      {/* draggable divider: scout ↔ stack (the two panes) */}
      <DragDivider
        cursor="col-resize"
        title="drag to resize the scout vs the stack · double-click resets"
        style={{ borderRadius: 3, alignSelf: 'stretch' }}
        onMove={(clientX) => {
          const r = gridRef.current?.getBoundingClientRect();
          if (!r || !r.width) return;
          setLeftFrac(Math.min(0.6, Math.max(0.18, (clientX - r.left) / r.width)));
        }}
        onReset={() => setLeftFrac(0.34)}
      />

      {/* right: output stack grid (+ vertical crop sliders on its edge) + stack controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, minWidth: 0 }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 4 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${gcols}, 1fr)`,
            gridTemplateRows: `repeat(${grows}, 1fr)`,
            gap: 4,
            position: 'relative',
          }}
        >
          {Array.from({ length: count }, (_, i) => {
            return (
            <div
              key={i}
              onPointerDown={onTileDown}
              onPointerMove={onTileMove}
              onPointerUp={onTileUp}
              onPointerCancel={onTileUp}
              onContextMenu={(e) => e.preventDefault()}
              title="right-drag = rotate the stack (MPR gesture)"
              style={{ position: 'relative', minHeight: 0, minWidth: 0, background: 'var(--viewport-bg)', borderRadius: 4, touchAction: 'none' }}
            >
              <canvas
                ref={(el) => {
                  sliceCvs.current[i] = el;
                }}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              />
            </div>
            );
          })}
          {!hasPath && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12, pointerEvents: 'none' }}>
              draw a line or curve on the scout — the resliced stack appears here
            </div>
          )}
          {rotChip && (
            <span
              style={{
                position: 'absolute',
                top: 6,
                right: 8,
                fontSize: 12,
                color: 'var(--text)',
                background: 'var(--panel-2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '2px 8px',
                pointerEvents: 'none',
                zIndex: 2,
              }}
            >
              {rotChip}
            </span>
          )}
        </div>
        <VertRangeSliders zFrac={zFrac} setZFrac={setZFrac} />
        </div>
        <div style={sliderRow}>
          <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
            slices {count}
            <input type="range" min={3} max={16} step={1} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 90 }} />
          </label>
          <span style={small} title="right-drag on any tile rotates the whole stack in-plane (MPR gesture)">
            tilt {tilt >= 0 ? '+' : ''}{tilt.toFixed(0)}°
          </span>
          {tilted && (
            <button style={chip(false)} title="back upright (0°) — scout and path editing return" onClick={() => setTilt(0)}>
              upright
            </button>
          )}
          <label style={{ ...small, flex: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
            distance {distance.toFixed(1)} mm
            <input type="range" min={0.5} max={10} step={0.5} value={distance} onChange={(e) => setDistance(Number(e.target.value))} style={{ flex: 1 }} />
          </label>
          <label style={{ ...small, flex: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
            width {width} mm
            <input type="range" min={10} max={60} step={2} value={width} onChange={(e) => setWidth(Number(e.target.value))} style={{ flex: 1 }} />
          </label>
          <label style={{ ...small, flex: 1, display: 'flex', gap: 6, alignItems: 'center' }} title="average this many mm into each slice">
            thickness {thickness.toFixed(1)} mm
            <input type="range" min={0} max={10} step={0.5} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} style={{ flex: 1 }} />
          </label>
          <label style={{ ...small, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={mip} onChange={(e) => setMip(e.target.checked)} /> MIP
          </label>
        </div>
      </div>

      {progress !== null && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(12,14,18,0.82)', zIndex: 5, color: 'var(--text-dim)' }}>
          loading volume… {Math.round((progress ?? 0) * 100)}%
        </div>
      )}
    </div>
  );
}
