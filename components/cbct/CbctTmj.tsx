'use client';
// TMJ module: read BOTH condyles side by side, each in
// sections corrected to its own axis. On the axial scout the reader drags one line per
// condyle along the long axis of the condylar head (the two heads never align with the
// straight sagittal/coronal planes — that is the whole point of the module). Each side then
// gets a fan of thin sections either PERPENDICULAR to its axis (corrected sagittal — the
// classic TMJ read) or PARALLEL to it (corrected coronal). "Mirror L/R" copies one line to
// the other side about the midline. Pure canvas off the shared HU cache, sibling of CbctPano.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadVolumeData, type CbctMeta, type VolumeEntry } from './volumeData';
import { axialSlice, drawImage, renderLineSection, type ZRange } from './curvedReformat';

interface Props {
  anon: string;
  voi: { center: number; width: number } | null;
  invert: boolean;
  onMeta?: (meta: CbctMeta) => void;
  onError?: (msg: string) => void;
}

type Side = 'R' | 'L';
/** Condyle axis line in axial mm coordinates (a → b, order as drawn). */
interface AxisLine {
  a: [number, number];
  b: [number, number];
}

const TMJ_KEY = (anon: string) => `cbctscope-tmj:v1:${anon}`;
const SIDE_COLOR: Record<Side, string> = { R: 'rgba(120,200,255,0.95)', L: 'rgba(224,179,65,0.95)' };
const MARKER_DIM = 'rgba(255,255,255,0.4)';

interface Persisted {
  lines: Partial<Record<Side, AxisLine>>;
  z: number;
}

function loadPersisted(anon: string): Persisted | null {
  try {
    const raw = localStorage.getItem(TMJ_KEY(anon));
    if (!raw) return null;
    const p = JSON.parse(raw) as Persisted;
    const ok = (l?: AxisLine) =>
      !l || (Array.isArray(l.a) && Array.isArray(l.b) && [...l.a, ...l.b].every(Number.isFinite));
    return ok(p.lines?.R) && ok(p.lines?.L) ? p : null;
  } catch {
    return null;
  }
}

/** Map a pointer event through an object-fit:contain canvas to DATA pixel coordinates. */
function containPos(
  cv: HTMLCanvasElement,
  e: { clientX: number; clientY: number },
): { x: number; y: number } | null {
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

/** Distance from point p to segment ab (all mm). */
function segDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const c1 = vx * wx + vy * wy;
  const c2 = vx * vx + vy * vy;
  const t = c2 > 0 ? Math.max(0, Math.min(1, c1 / c2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

export default function CbctTmj({ anon, voi, invert, onMeta, onError }: Props) {
  const [entry, setEntry] = useState<VolumeEntry | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [z, setZ] = useState(0);
  const [lines, setLines] = useState<Partial<Record<Side, AxisLine>>>({});
  const [sync, setSync] = useState(false);
  const [nSec, setNSec] = useState(5);
  const [secSpacing, setSecSpacing] = useState(2.5);
  const [secWidth, setSecWidth] = useState(34);
  const [secThickness, setSecThickness] = useState(0.5);
  const [mode, setMode] = useState<'perp' | 'para'>('perp');
  const [zFrac, setZFrac] = useState<[number, number]>([0.25, 1]);
  const [draft, setDraft] = useState<AxisLine | null>(null); // line being drawn

  const axialCv = useRef<HTMLCanvasElement | null>(null);
  const sectionCvs = useRef<Record<Side, (HTMLCanvasElement | null)[]>>({ R: [], L: [] });
  const dragRef = useRef<
    | { kind: 'draw' }
    | { kind: 'endpoint'; side: Side; end: 'a' | 'b' }
    | { kind: 'move'; side: Side; last: [number, number] }
    | null
  >(null);
  const draftRef = useRef<AxisLine | null>(null);

  // ---- volume load (usually a cache hit from the other views)
  useEffect(() => {
    let stale = false;
    setEntry(null);
    setProgress(0);
    setLines({});
    setDraft(null);
    loadVolumeData(anon, (f) => !stale && setProgress(Math.min(0.95, f)))
      .then((e) => {
        if (stale) return;
        setEntry(e);
        onMeta?.(e.meta);
        const saved = loadPersisted(anon);
        setLines(saved?.lines ?? {});
        // condyles live in the upper part of a head volume — start the scout there
        setZ(saved?.z ?? Math.round(e.meta.dims[2] * 0.72));
        setProgress(null);
      })
      .catch((err) => {
        console.error('[cbct-tmj] load failed', err);
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

  // ---- persist lines + scout slice (debounced)
  useEffect(() => {
    if (!entry) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(TMJ_KEY(anon), JSON.stringify({ lines, z }));
      } catch {
        /* storage full */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [lines, z, anon, entry]);

  const effVoi = useMemo(
    () => voi ?? entry?.meta.defaultVoi ?? { center: 300, width: 2500 },
    [voi, entry],
  );
  const dims = entry?.meta.dims ?? [1, 1, 1];
  const spacing = entry?.meta.spacing ?? [0.2, 0.2, 0.2];
  const sx = spacing[0];
  const sy = spacing[1];
  const slices = dims[2];
  const midX = (dims[0] * sx) / 2; // patient midline (mm)

  const zRange = useMemo<ZRange>(() => {
    const zLo = Math.round(zFrac[0] * (slices - 1));
    const zHi = Math.max(zLo + 3, Math.round(zFrac[1] * (slices - 1)));
    return { zLo, zHi: Math.min(slices - 1, zHi) };
  }, [zFrac, slices]);

  /** Mirror a line about the patient midline (sync-sides). */
  const mirrorLine = useCallback(
    (l: AxisLine): AxisLine => ({
      a: [2 * midX - l.a[0], l.a[1]],
      b: [2 * midX - l.b[0], l.b[1]],
    }),
    [midX],
  );

  /** Commit a line to a side; with sync on, the other side gets the mirror. */
  const commitLine = useCallback(
    (l: AxisLine) => {
      const cx = (l.a[0] + l.b[0]) / 2;
      const side: Side = cx < midX ? 'R' : 'L'; // LPS: +x = patient LEFT ⇒ low x = RIGHT
      setLines((cur) => (sync ? { R: side === 'R' ? l : mirrorLine(l), L: side === 'L' ? l : mirrorLine(l) } : { ...cur, [side]: l }));
    },
    [midX, sync, mirrorLine],
  );

  /** Per-side section geometry: centers stepped along the axis (or its normal), oriented
   *  consistently — axis direction points MEDIAL, section columns point ANTERIOR. */
  const sideGeom = useCallback(
    (side: Side) => {
      const l = lines[side];
      if (!l) return null;
      let dx = l.b[0] - l.a[0];
      let dy = l.b[1] - l.a[1];
      const len = Math.hypot(dx, dy);
      if (len < 4) return null;
      dx /= len;
      dy /= len;
      // axis points medial: toward +x on the right side, toward −x on the left
      const wantX = side === 'R' ? 1 : -1;
      if (dx * wantX < 0) {
        dx = -dx;
        dy = -dy;
      }
      // in-plane perpendicular pointing anterior (−y)
      let px = -dy;
      let py = dx;
      if (py > 0) {
        px = -px;
        py = -py;
      }
      const mid: [number, number] = [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2];
      return { d: [dx, dy] as [number, number], p: [px, py] as [number, number], mid, len };
    },
    [lines],
  );

  // ---- draw: axial scout + axis lines + section ticks
  useEffect(() => {
    const cv = axialCv.current;
    if (!cv || !entry) return;
    const img = axialSlice(entry, z);
    drawImage(cv, img, effVoi, invert);
    const ctx = cv.getContext('2d')!;
    const toPx = (p: [number, number]): [number, number] => [p[0] / img.pxW, p[1] / img.pxH];
    const drawLine = (l: AxisLine, color: string, label: Side | null) => {
      const [x1, y1] = toPx(l.a);
      const [x2, y2] = toPx(l.b);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      for (const [x, y] of [[x1, y1], [x2, y2]]) {
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (label) {
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(label, (x1 + x2) / 2 + 8, (y1 + y2) / 2 - 8);
      }
    };
    // section tick marks per side
    for (const side of ['R', 'L'] as Side[]) {
      const g = sideGeom(side);
      const l = lines[side];
      if (!g || !l) continue;
      ctx.strokeStyle = MARKER_DIM;
      ctx.lineWidth = 1;
      const tickHalf = (mode === 'perp' ? secWidth * 0.35 : Math.max(10, g.len * 0.6)) / img.pxW;
      for (let k = 0; k < nSec; k++) {
        const off = (k - (nSec - 1) / 2) * secSpacing;
        // perp: centers step ALONG the axis, planes ⊥ axis (ticks along p)
        // para: centers step along p, planes ∥ axis (ticks along d)
        const cxMm = g.mid[0] + (mode === 'perp' ? g.d[0] : g.p[0]) * off;
        const cyMm = g.mid[1] + (mode === 'perp' ? g.d[1] : g.p[1]) * off;
        const tx = mode === 'perp' ? g.p[0] : g.d[0];
        const ty = mode === 'perp' ? g.p[1] : g.d[1];
        const cx = cxMm / img.pxW;
        const cy = cyMm / img.pxH;
        ctx.beginPath();
        ctx.moveTo(cx - tx * tickHalf, cy - ty * tickHalf);
        ctx.lineTo(cx + tx * tickHalf, cy + ty * tickHalf);
        ctx.stroke();
      }
      drawLine(l, SIDE_COLOR[side], side);
    }
    if (draft) drawLine(draft, 'rgba(255,255,255,0.85)', null);
  }, [entry, z, effVoi, invert, lines, draft, sideGeom, nSec, secSpacing, secWidth, mode]);

  // ---- draw: per-side sections
  useEffect(() => {
    if (!entry) return;
    for (const side of ['R', 'L'] as Side[]) {
      const g = sideGeom(side);
      for (let k = 0; k < nSec; k++) {
        const cv = sectionCvs.current[side][k];
        if (!cv) continue;
        if (!g) {
          cv.width = 120;
          cv.height = 160;
          const ctx = cv.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, cv.width, cv.height);
          }
          continue;
        }
        const off = (k - (nSec - 1) / 2) * secSpacing;
        const cxMm = g.mid[0] + (mode === 'perp' ? g.d[0] : g.p[0]) * off;
        const cyMm = g.mid[1] + (mode === 'perp' ? g.d[1] : g.p[1]) * off;
        // perp: image columns run along p (anterior at left); para: along d (medial at right)
        const colDir = mode === 'perp' ? g.p : g.d;
        const img = renderLineSection(entry, cxMm, cyMm, colDir[0], colDir[1], secWidth, {
          thicknessMm: secThickness,
          range: zRange,
        });
        drawImage(cv, img, effVoi, invert);
        const ctx = cv.getContext('2d')!;
        ctx.strokeStyle = MARKER_DIM;
        ctx.beginPath();
        ctx.moveTo(img.width / 2, 0);
        ctx.lineTo(img.width / 2, img.height);
        ctx.stroke();
        ctx.fillStyle = SIDE_COLOR[side];
        ctx.font = '10px sans-serif';
        ctx.fillText(`${side}${k + 1} · ${off > 0 ? '+' : ''}${off.toFixed(1)} mm`, 4, 11);
        if (mode === 'perp') {
          ctx.fillStyle = 'rgba(230,233,239,0.75)';
          ctx.fillText('A', 3, img.height - 4);
          ctx.fillText('P', img.width - 10, img.height - 4);
        } else {
          ctx.fillStyle = 'rgba(230,233,239,0.75)';
          ctx.fillText(side === 'R' ? 'lat' : 'med', 3, img.height - 4);
          ctx.fillText(side === 'R' ? 'med' : 'lat', img.width - 22, img.height - 4);
        }
      }
    }
  }, [entry, sideGeom, nSec, secSpacing, secWidth, secThickness, mode, zRange, effVoi, invert, lines]);

  // ---- axial interactions: draw a new axis line; drag endpoints; move a line; right-click deletes
  const axialPos = useCallback(
    (e: { clientX: number; clientY: number }): [number, number] | null => {
      const cv = axialCv.current;
      if (!cv || !entry) return null;
      const p = containPos(cv, e);
      return p ? [p.x * sx, p.y * sy] : null;
    },
    [entry, sx, sy],
  );

  const hitTest = useCallback(
    (p: [number, number]): { side: Side; end?: 'a' | 'b' } | null => {
      const endThresh = 3; // mm
      const lineThresh = 2.5;
      for (const side of ['R', 'L'] as Side[]) {
        const l = lines[side];
        if (!l) continue;
        if (Math.hypot(p[0] - l.a[0], p[1] - l.a[1]) < endThresh) return { side, end: 'a' };
        if (Math.hypot(p[0] - l.b[0], p[1] - l.b[1]) < endThresh) return { side, end: 'b' };
        if (segDist(p, l.a, l.b) < lineThresh) return { side };
      }
      return null;
    },
    [lines],
  );

  const onAxialDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const p = axialPos(e);
    if (!p) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const hit = hitTest(p);
    if (hit?.end) {
      dragRef.current = { kind: 'endpoint', side: hit.side, end: hit.end };
    } else if (hit) {
      dragRef.current = { kind: 'move', side: hit.side, last: p };
    } else {
      dragRef.current = { kind: 'draw' };
      const d: AxisLine = { a: p, b: p };
      draftRef.current = d;
      setDraft(d);
    }
  };
  const onAxialMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const p = axialPos(e);
    if (!p) return;
    if (drag.kind === 'draw') {
      const d = { ...draftRef.current!, b: p };
      draftRef.current = d;
      setDraft(d);
    } else if (drag.kind === 'endpoint') {
      setLines((cur) => {
        const l = cur[drag.side];
        if (!l) return cur;
        const next = { ...l, [drag.end]: p };
        if (sync) {
          const other: Side = drag.side === 'R' ? 'L' : 'R';
          return { ...cur, [drag.side]: next, [other]: mirrorLine(next) };
        }
        return { ...cur, [drag.side]: next };
      });
    } else {
      const dx = p[0] - drag.last[0];
      const dy = p[1] - drag.last[1];
      drag.last = p;
      setLines((cur) => {
        const l = cur[drag.side];
        if (!l) return cur;
        const next: AxisLine = {
          a: [l.a[0] + dx, l.a[1] + dy],
          b: [l.b[0] + dx, l.b[1] + dy],
        };
        if (sync) {
          const other: Side = drag.side === 'R' ? 'L' : 'R';
          return { ...cur, [drag.side]: next, [other]: mirrorLine(next) };
        }
        return { ...cur, [drag.side]: next };
      });
    }
  };
  const onAxialUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === 'draw') {
      const d = draftRef.current;
      draftRef.current = null;
      setDraft(null);
      if (d && Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) >= 5) commitLine(d);
    }
  };
  const onAxialContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const p = axialPos(e);
    if (!p) return;
    const hit = hitTest(p);
    if (hit) {
      setLines((cur) => {
        const next = { ...cur };
        delete next[hit.side];
        return next;
      });
    }
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

  const small: React.CSSProperties = { fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' };
  const sliderRow: React.CSSProperties = {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    padding: '4px 2px',
    flexWrap: 'wrap',
  };
  const chip = (active: boolean): React.CSSProperties => ({
    padding: '3px 8px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent-dim)' : 'var(--panel-2)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: 11,
  });

  const sideRow = (side: Side) => (
    <div key={side} style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', gap: 6 }}>
      <span
        style={{
          position: 'absolute',
          top: 4,
          left: 6,
          zIndex: 1,
          fontSize: 12,
          fontWeight: 700,
          color: SIDE_COLOR[side],
          textShadow: '0 1px 2px #000',
          pointerEvents: 'none',
        }}
      >
        {side === 'R' ? 'RIGHT condyle' : 'LEFT condyle'}
      </span>
      {Array.from({ length: nSec }, (_, k) => (
        <div key={k} style={{ position: 'relative', flex: 1, minWidth: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
          <canvas
            ref={(el) => {
              sectionCvs.current[side][k] = el;
            }}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        </div>
      ))}
      {!lines[side] && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-dim)',
            fontSize: 12,
            pointerEvents: 'none',
          }}
        >
          drag a line along the {side === 'R' ? 'right' : 'left'} condyle head on the axial scout
        </div>
      )}
    </div>
  );

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
      {/* left: axial scout + controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
          <canvas
            ref={axialCv}
            onPointerDown={onAxialDown}
            onPointerMove={onAxialMove}
            onPointerUp={onAxialUp}
            onContextMenu={onAxialContext}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              cursor: 'crosshair',
              touchAction: 'none',
              display: 'block',
            }}
          />
          <span style={{ position: 'absolute', top: 6, left: 8, ...small, pointerEvents: 'none' }}>
            AXIAL {entry ? `${z + 1}/${slices}` : ''} · scroll to the condyles · drag = axis line per side ·
            right-click = delete
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
            style={{
              position: 'absolute',
              right: 2,
              top: 26,
              bottom: 26,
              width: 20,
              height: 'auto',
              writingMode: 'vertical-lr',
              direction: 'rtl',
              zIndex: 1,
            }}
          />
        </div>
        <div style={sliderRow}>
          <button
            style={chip(mode === 'perp')}
            title="sections PERPENDICULAR to each condyle's axis (corrected sagittal — the classic TMJ read)"
            onClick={() => setMode('perp')}
          >
            ⊥ axis
          </button>
          <button
            style={chip(mode === 'para')}
            title="sections PARALLEL to each condyle's axis (corrected coronal)"
            onClick={() => setMode('para')}
          >
            ∥ axis
          </button>
          <label style={{ ...small, display: 'flex', gap: 4, alignItems: 'center' }} title="editing one side mirrors the line to the other side about the midline">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> mirror L/R
          </label>
          <button
            style={chip(false)}
            disabled={!lines.R && !lines.L}
            title="delete both axis lines"
            onClick={() => setLines({})}
          >
            clear lines
          </button>
        </div>
        <div style={sliderRow}>
          <span style={small} title="trim the sections vertically — keep the condyle/fossa region">
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
          Drag one line along each condyle head (lateral pole → medial pole). Sections are cut
          against each side&apos;s own axis, so the joint is read in ITS plane — not the
          scanner&apos;s. ⊥ axis = corrected sagittal · ∥ axis = corrected coronal.
        </div>
      </div>

      {/* right: RIGHT condyle row over LEFT condyle row + shared section controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, minWidth: 0 }}>
        {sideRow('R')}
        {sideRow('L')}
        <div style={sliderRow}>
          <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
            sections {nSec}
            <input
              type="range"
              min={3}
              max={9}
              step={2}
              value={nSec}
              onChange={(e) => setNSec(Number(e.target.value))}
              style={{ width: 70 }}
            />
          </label>
          <label style={{ ...small, flex: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
            spacing {secSpacing.toFixed(1)} mm
            <input
              type="range"
              min={0.5}
              max={6}
              step={0.5}
              value={secSpacing}
              onChange={(e) => setSecSpacing(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </label>
          <label style={{ ...small, flex: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
            width {secWidth} mm
            <input
              type="range"
              min={16}
              max={60}
              step={2}
              value={secWidth}
              onChange={(e) => setSecWidth(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </label>
          <label style={{ ...small, flex: 1, display: 'flex', gap: 6, alignItems: 'center' }} title="average this many mm across each section — a thicker, quieter cut">
            thickness {secThickness.toFixed(1)} mm
            <input
              type="range"
              min={0}
              max={6}
              step={0.5}
              value={secThickness}
              onChange={(e) => setSecThickness(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </label>
        </div>
      </div>

      {progress !== null && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(12,14,18,0.82)',
            zIndex: 5,
            color: 'var(--text-dim)',
          }}
        >
          loading volume… {Math.round((progress ?? 0) * 100)}%
        </div>
      )}
    </div>
  );
}
