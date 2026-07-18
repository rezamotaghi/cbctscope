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

interface Props {
  anon: string;
  voi: { center: number; width: number } | null;
  invert: boolean;
  onMeta?: (meta: CbctMeta) => void;
  onError?: (msg: string) => void;
}

const RESLICE_KEY = (anon: string) => `cbctscope-reslice:v1:${anon}`;
const ACCENT = 'rgba(76,141,255,0.95)';
const MARKER = 'rgba(224,179,65,0.95)';
const MARKER_DIM = 'rgba(224,179,65,0.45)';

interface Persisted {
  points: ArchPoint[];
  z: number;
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

  const axialCv = useRef<HTMLCanvasElement | null>(null);
  const sliceCvs = useRef<(HTMLCanvasElement | null)[]>([]);
  const dragIdx = useRef(-1);
  const strokeRef = useRef<ArchPoint[] | null>(null);

  useEffect(() => {
    let stale = false;
    setEntry(null);
    setProgress(0);
    setPoints([]);
    setStroke(null);
    loadVolumeData(anon, (f) => !stale && setProgress(Math.min(0.95, f)))
      .then((e) => {
        if (stale) return;
        setEntry(e);
        onMeta?.(e.meta);
        const saved = loadPersisted(anon);
        setPoints(saved?.points ?? []);
        setZ(saved?.z ?? Math.round(e.meta.dims[2] * 0.5));
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
        localStorage.setItem(RESLICE_KEY(anon), JSON.stringify({ points, z }));
      } catch {
        /* storage full */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [points, z, anon, entry]);

  const effVoi = useMemo(() => voi ?? entry?.meta.defaultVoi ?? { center: 300, width: 2500 }, [voi, entry]);
  const dims = entry?.meta.dims ?? [1, 1, 1];
  const spacing = entry?.meta.spacing ?? [0.2, 0.2, 0.2];
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

  // ---- draw axial scout: slice + path + stack markers
  useEffect(() => {
    const cv = axialCv.current;
    if (!cv || !entry) return;
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
  }, [entry, z, effVoi, invert, curve, line, points, stroke, sliceGeoms, count, distance, width, outMode, hoverIdx]);

  // ---- draw the output stack
  useEffect(() => {
    if (!entry || !hasPath) return;
    for (let i = 0; i < count; i++) {
      const cv = sliceCvs.current[i];
      if (!cv) continue;
      let img;
      if (line) {
        const g = sliceGeoms[i];
        img = renderLineSection(entry, g.cx, g.cy, g.dirX, g.dirY, width, { thicknessMm: thickness, range: zRange, mip });
      } else if (curve) {
        const off = (i - (count - 1) / 2) * distance;
        if (outMode === 'cross') {
          const s = Math.max(0, Math.min(curve.length, curve.length / 2 + off));
          img = renderSection(entry, curve, s, width, { thicknessMm: thickness, range: zRange });
        } else {
          // parallel curved reformats = the arch swept at a buccolingual shift
          img = renderPano(entry, curve, Math.max(2, thickness || 2), mip, { shiftMm: off, range: zRange });
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
  }, [entry, hasPath, line, curve, sliceGeoms, count, distance, width, thickness, mip, outMode, zRange, effVoi, invert]);

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

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = axialPos(e);
    if (!p) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const hit = hitPoint(p);
    if (hit >= 0) dragIdx.current = hit;
    else {
      strokeRef.current = [p];
      setStroke([p]);
    }
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragIdx.current >= 0) {
      const p = axialPos(e);
      if (p) setPoints((pts) => pts.map((q, i) => (i === dragIdx.current ? p : q)));
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
    setHoverIdx(p ? hitPoint(p) : -1);
  };
  const onUp = () => {
    dragIdx.current = -1;
    const st = strokeRef.current;
    strokeRef.current = null;
    setStroke(null);
    if (!st) return;
    const len = st.reduce((a, p, i) => (i ? a + Math.hypot(p.x - st[i - 1].x, p.y - st[i - 1].y) : 0), 0);
    if (len > 12) setPoints(simplifyStroke(st)); // a stroke REPLACES the path
    else setPoints((pts) => [...pts, st[0]]); // a click appends a control point
  };
  const deleteAt = (e: { clientX: number; clientY: number }) => {
    const p = axialPos(e);
    if (!p) return;
    const hit = hitPoint(p);
    if (hit >= 0) {
      setPoints((pts) => pts.filter((_, i) => i !== hit));
      setHoverIdx(-1);
    }
  };
  const onContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
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
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'minmax(300px, 34%) 1fr',
        gap: 8,
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
            onContextMenu={onContext}
            style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: hoverIdx >= 0 ? 'grab' : 'crosshair', touchAction: 'none', display: 'block' }}
          />
          <span style={{ position: 'absolute', top: 6, left: 8, ...small, pointerEvents: 'none' }}>
            AXIAL {entry ? `${z + 1}/${slices}` : ''} · drag a line (2 pts) or curve (≥3) · click = add · right-click = delete
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
          <button style={chip(false)} disabled={!points.length} title="delete the drawn path" onClick={() => setPoints([])}>
            clear path
          </button>
          <button style={chip(false)} disabled={!hasPath} title="save the whole stack as one PNG" onClick={saveStack}>
            💾 save stack
          </button>
          <span style={small}>{isCurved ? 'curved arc' : line ? 'straight line' : `${points.length}/2 points`}</span>
        </div>
        <div style={sliderRow}>
          <span style={small} title="trim the stack vertically">
            vertical range {Math.round(zFrac[0] * 100)}–{Math.round(zFrac[1] * 100)}%
          </span>
          {([0, 1] as const).map((idx) => (
            <input
              key={idx}
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(zFrac[idx] * 100)}
              title={idx === 0 ? 'bottom trim (inferior)' : 'top trim (superior)'}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                setZFrac((cur) => {
                  const next: [number, number] = [...cur];
                  next[idx] = idx === 0 ? Math.min(v, cur[1] - 0.05) : Math.max(v, cur[0] + 0.05);
                  return next;
                });
              }}
              style={{ flex: 1 }}
            />
          ))}
        </div>
        <div style={{ ...small, whiteSpace: 'normal', lineHeight: 1.5 }}>
          Draw ANY line or arc on the scout and get a fresh slice stack cut against it — a road
          through the volume no orthogonal plane gives you. ⊥ cross walks the path cutting
          across it; ∥ parallel stacks slices along it.
        </div>
      </div>

      {/* right: output stack grid + stack controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, minWidth: 0 }}>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${gcols}, 1fr)`,
            gridTemplateRows: `repeat(${grows}, 1fr)`,
            gap: 4,
            position: 'relative',
          }}
        >
          {Array.from({ length: count }, (_, i) => (
            <div key={i} style={{ position: 'relative', minHeight: 0, minWidth: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
              <canvas
                ref={(el) => {
                  sliceCvs.current[i] = el;
                }}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              />
            </div>
          ))}
          {!hasPath && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12, pointerEvents: 'none' }}>
              draw a line or curve on the scout — the resliced stack appears here
            </div>
          )}
        </div>
        <div style={sliderRow}>
          <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
            slices {count}
            <input type="range" min={3} max={16} step={1} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 90 }} />
          </label>
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
