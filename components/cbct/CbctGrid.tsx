'use client';
// Multi-slice viewport grid (number of images / layer thickness / layer distance):
// one screen shows N parallel slices at a chosen spacing + slab thickness, with a reference
// scout pane showing numbered section lines. The SCOUT is the control surface (MPR
// conventions): right-drag rotates the scout IMAGE itself — the
// section lines stay put on screen and the stack re-cuts obliquely through the turned
// anatomy; left-drag grabs the section window. Tiles are display-only; wheel steps the
// window. Pure-CPU oblique resampling off the shared Int16 HU buffer — no Cornerstone in
// this path, sibling of CbctPano.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadVolumeData, type CbctMeta } from './volumeData';
import { renderOblique, rotV, extentAlong, canvasPoint, handOf, type Basis } from './oblique';
import { composeGridSnapshot, type SnapPane } from './evidence';
import DragDivider from './DragDivider';
import type { VolumeEntry } from './volumeData';

type Plane = 'axial' | 'sagittal' | 'coronal';

interface Props {
  anon: string;
  voi: { center: number; width: number } | null;
  invert: boolean;
  gamma: number;
  onMeta?: (meta: CbctMeta) => void;
  onError?: (msg: string) => void;
}

const GRIDS: Record<string, [number, number]> = {
  '2×2': [2, 2],
  '3×3': [3, 3],
  '4×4': [4, 4],
  '4×6': [4, 6],
};

// Initial (orthogonal) bases — orientations match the MPR panes:
// axial R left / A top · sagittal A left / S top · coronal R left / S top
// (LPS voxels: +x=L, +y=P, +z=S; v points DOWN the image rows).
const INIT_BASIS: Record<Plane, Basis> = {
  axial: { u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  sagittal: { u: [0, 1, 0], v: [0, 0, -1], n: [1, 0, 0] },
  coronal: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] },
};

// Scout pane basis per grid plane (axial grid → sagittal scout; sagittal/coronal → axial).
const SCOUT_BASIS: Record<Plane, Basis> = {
  axial: INIT_BASIS.sagittal,
  sagittal: INIT_BASIS.axial,
  coronal: INIT_BASIS.axial,
};
const SCOUT_NAME: Record<Plane, string> = { axial: 'SAGITTAL', sagittal: 'AXIAL', coronal: 'AXIAL' };

const LINE_COLOR = 'rgba(255, 210, 80, 0.95)';
const SCOUT_PCT_KEY = 'cbct-grid-scout-pct'; // persisted scout|stack split (draggable pane line)
const SCOUT_PCT_DEFAULT = 26;
const clampScoutPct = (v: number) => Math.min(60, Math.max(12, v));
const DEG_PER_PX = 0.35; // hub fallback only — same feel as the MPR right-drag
const HUB_PX = 24; // same dead-zone as the MPR rotate

// The MPR rotate mapping: the cursor SWEEPS its angle around the pivot (grab the image and
// turn it like a wheel), so a downward drag reads CW right of the pivot and CCW left of it.
// A plain (dx−dy) mapping can't do that — it feels inverted on one side. Screen y grows
// downward, so atan2 increases clockwise — +deg = clockwise, matching the handOf sign
// convention. Inside the hub the angle is unstable → linear distance fallback.
const sweepDeg = (px: number, py: number, x0: number, y0: number, x1: number, y1: number): number => {
  if (Math.hypot(x0 - px, y0 - py) < HUB_PX || Math.hypot(x1 - px, y1 - py) < HUB_PX) {
    return (x1 - x0 - (y1 - y0)) * DEG_PER_PX;
  }
  let deg = ((Math.atan2(y1 - py, x1 - px) - Math.atan2(y0 - py, x0 - px)) * 180) / Math.PI;
  if (deg > 180) deg -= 360;
  else if (deg < -180) deg += 360;
  return deg;
};

export default function CbctGrid({ anon, voi, invert, gamma, onMeta, onError }: Props) {
  const [entry, setEntry] = useState<VolumeEntry | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [plane, setPlane] = useState<Plane>('axial');
  const [gridKey, setGridKey] = useState<string>('3×3');
  const [spacingMm, setSpacingMm] = useState(2);
  const [thickMm, setThickMm] = useState(0.5);
  const [mip, setMip] = useState(false);
  const [basis, setBasis] = useState<Basis>(INIT_BASIS.axial);
  // The scout's own basis is state too: right-drag rotates the scout IMAGE (its u/v spin
  // about its normal) together with the grid frame — so the section lines stay put on
  // screen while the anatomy turns under them (MPR section-rotation convention).
  const [scoutBasis, setScoutBasis] = useState<Basis>(SCOUT_BASIS.axial);
  const [centerOff, setCenterOff] = useState(0); // window center, voxels along n from volume center
  const [chip, setChip] = useState<string | null>(null); // live drag readout
  // Draggable scout|stack pane line: default renders first (hydration-safe), the persisted
  // width loads in an effect; persisted on release.
  const [scoutPct, setScoutPct] = useState(SCOUT_PCT_DEFAULT);
  const scoutPctRef = useRef(scoutPct);
  scoutPctRef.current = scoutPct;
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(SCOUT_PCT_KEY));
      if (v) setScoutPct(clampScoutPct(v));
    } catch {
      /* nothing persisted */
    }
  }, []);
  const persistScoutPct = () => {
    try {
      localStorage.setItem(SCOUT_PCT_KEY, String(scoutPctRef.current));
    } catch {
      /* best-effort */
    }
  };
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const refCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let stale = false;
    setEntry(null);
    setProgress(0);
    setCenterOff(0);
    loadVolumeData(anon, (f) => !stale && setProgress(f))
      .then((e) => {
        if (stale) return;
        setEntry(e);
        setProgress(null);
        onMeta?.(e.meta);
      })
      .catch(() => {
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

  const resetOrientation = useCallback(
    (p: Plane) => {
      setBasis(INIT_BASIS[p]);
      setScoutBasis(SCOUT_BASIS[p]);
      setCenterOff(0);
    },
    [],
  );

  const voxMm = entry ? entry.meta.spacing[0] : 1; // isotropic voxels
  const [rows, cols] = GRIDS[gridKey];
  const count = rows * cols;
  const stepVox = Math.max(1, Math.round(spacingMm / voxMm));
  const slabVox = Math.max(1, Math.round(thickMm / voxMm));
  const maxOff = entry ? Math.floor(extentAlong(basis.n, entry.meta.dims) / 2) - 1 : 0;
  const lowerHu = (voi?.center ?? entry?.meta.defaultVoi.center ?? 0) - (voi?.width ?? entry?.meta.defaultVoi.width ?? 1) / 2;
  const upperHu = (voi?.center ?? entry?.meta.defaultVoi.center ?? 0) + (voi?.width ?? entry?.meta.defaultVoi.width ?? 1) / 2;

  // per-tile offsets along n, centered on centerOff
  const offsets = useMemo(
    () => Array.from({ length: count }, (_, k) => centerOff + (k - (count - 1) / 2) * stepVox),
    [count, centerOff, stepVox],
  );

  // snapshot: scout + the whole tile block, laid out as on screen, → one PNG download
  // (labels, case·timestamp footer, evidence overlays included; the double-rAF makes sure
  // the latest redraw has painted)
  const takeSnapshot = async () => {
    if (!entry) return;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const scoutCv = refCanvasRef.current;
    const scoutPane: SnapPane | null = scoutCv
      ? { canvas: scoutCv, svg: null, label: `${SCOUT_NAME[plane]} scout` }
      : null;
    const tiles: SnapPane[] = [];
    offsets.forEach((off, k) => {
      const cv = canvasRefs.current[k];
      if (!cv) return;
      const svg = (cv.parentElement?.querySelector('svg') as SVGSVGElement | null) ?? null;
      tiles.push({ canvas: cv, svg, label: `${k + 1} · ${(off * voxMm).toFixed(1)} mm` });
    });
    const url = await composeGridSnapshot(scoutPane, tiles, cols, `${anon} · ${new Date().toLocaleString()}`);
    if (!url) return;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${anon}-grid-${ts}.png`;
    a.click();
  };

  // ---- draw tiles
  useEffect(() => {
    if (!entry) return;
    const raf = requestAnimationFrame(() => {
      offsets.forEach((off, k) => {
        const cv = canvasRefs.current[k];
        if (!cv) return;
        const ctx = cv.getContext('2d');
        if (!ctx) return;
        const img = renderOblique(entry, basis, off, slabVox, mip, lowerHu, upperHu, invert, gamma);
        cv.width = img.width;
        cv.height = img.height;
        ctx.putImageData(img, 0, 0);
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [entry, offsets, basis, slabVox, mip, lowerHu, upperHu, invert, gamma]);

  // ---- draw scout + section lines. The scout rotates WITH the grid frame (right-drag), so
  // the lines stay fixed on screen and the anatomy turns under them.
  const scout = scoutBasis;
  useEffect(() => {
    if (!entry) return;
    const cv = refCanvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const raf = requestAnimationFrame(() => {
      const img = renderOblique(entry, scout, 0, 1, false, lowerHu, upperHu, invert, gamma);
      cv.width = img.width;
      cv.height = img.height;
      ctx.putImageData(img, 0, 0);
      // grid plane k ∩ scout plane: A·(c-w/2) + B·(r-h/2) = off_k, A = n·u_s, B = n·v_s
      const { n } = basis;
      const A = n[0] * scout.u[0] + n[1] * scout.u[1] + n[2] * scout.u[2];
      const B = n[0] * scout.v[0] + n[1] * scout.v[1] + n[2] * scout.v[2];
      const w = cv.width;
      const h = cv.height;
      ctx.strokeStyle = LINE_COLOR;
      ctx.fillStyle = LINE_COLOR;
      ctx.lineWidth = 1;
      ctx.font = '10px system-ui';
      const labelEvery = offsets.length > 12 ? 2 : 1;
      offsets.forEach((off, k) => {
        let p0: [number, number] | null = null;
        let p1: [number, number] | null = null;
        if (Math.abs(B) >= Math.abs(A)) {
          // shallow line: param by column
          const rAt = (c: number) => h / 2 + (off - A * (c - w / 2)) / B;
          p0 = [0, rAt(0)];
          p1 = [w, rAt(w)];
        } else {
          const cAt = (r: number) => w / 2 + (off - B * (r - h / 2)) / A;
          p0 = [cAt(0), 0];
          p1 = [cAt(h), h];
        }
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.stroke();
        if (k % labelEvery === 0) {
          const lx = Math.max(2, Math.min(w - 12, p0[0] + (p1[0] - p0[0]) * 0.04));
          const ly = Math.max(9, Math.min(h - 2, p0[1] + (p1[1] - p0[1]) * 0.04 - 2));
          ctx.fillText(String(k + 1), lx, ly);
        }
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [entry, offsets, basis, scout, lowerHu, upperHu, invert, gamma]);

  // ---- interactions (MPR conventions, on the SCOUT only — tiles are display + wheel) -----
  // scout: left-drag/click = grab the section window · right-drag = rotate the scout image
  // (the whole cutting frame turns with it; lines stay put on screen)
  const dragRef = useRef<{
    kind: 'scout-move' | 'scout-rotate' | 'tile-rotate';
    lastX: number;
    lastY: number;
    totalDeg: number;
    px: number; // sweep pivot (client coords) — the grabbed pane's raster center
    py: number;
  } | null>(null);

  const scoutOffsetAt = (e: { clientX: number; clientY: number }): number | null => {
    const cv = refCanvasRef.current;
    if (!cv) return null;
    const pt = canvasPoint(cv, e);
    if (!pt) return null;
    const { n } = basis;
    const A = n[0] * scout.u[0] + n[1] * scout.u[1] + n[2] * scout.u[2];
    const B = n[0] * scout.v[0] + n[1] * scout.v[1] + n[2] * scout.v[2];
    return A * (pt[0] - cv.width / 2) + B * (pt[1] - cv.height / 2);
  };

  const clampOff = useCallback(
    (o: number) => Math.max(-maxOff, Math.min(maxOff, o)),
    [maxOff],
  );

  const onScoutDown = (e: React.PointerEvent) => {
    if (!entry) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = r.left + r.width / 2; // object-fit:contain centers the raster → element center = raster center
    const py = r.top + r.height / 2;
    if (e.button === 2) {
      dragRef.current = { kind: 'scout-rotate', lastX: e.clientX, lastY: e.clientY, totalDeg: 0, px, py };
      setChip('rotating 0°');
    } else if (e.button === 0) {
      dragRef.current = { kind: 'scout-move', lastX: e.clientX, lastY: e.clientY, totalDeg: 0, px, py };
      const o = scoutOffsetAt(e);
      if (o != null) setCenterOff(clampOff(o));
    }
  };

  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !entry) return;
    const prevX = d.lastX;
    const prevY = d.lastY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (d.kind === 'scout-move') {
      const o = scoutOffsetAt(e);
      if (o != null) setCenterOff(clampOff(o));
    } else if (d.kind === 'scout-rotate') {
      const deg = sweepDeg(d.px, d.py, prevX, prevY, e.clientX, e.clientY);
      if (!deg) return;
      d.totalDeg += deg;
      // rotate the scout image AND the cutting frame together about the scout normal —
      // on screen the anatomy turns, the section lines stay where they are, and the grid
      // slices re-cut through the rotated anatomy (oblique stack)
      const axis = scout.n;
      // MPR convention: +drag turns the anatomy CLOCKWISE — rotate about the scout's
      // OUT-OF-SCREEN direction, which handOf reads off the basis (the axial scout's n
      // points into the screen, the sagittal scout's out — no fixed sign serves both).
      const a = handOf(scout) > 0 ? -deg : deg;
      setScoutBasis((b) => ({ u: rotV(b.u, axis, a), v: rotV(b.v, axis, a), n: b.n }));
      setBasis((b) => ({ u: rotV(b.u, axis, a), v: rotV(b.v, axis, a), n: rotV(b.n, axis, a) }));
      setChip(`rotating ${d.totalDeg >= 0 ? '+' : ''}${d.totalDeg.toFixed(0)}°`);
    } else {
      const deg = sweepDeg(d.px, d.py, prevX, prevY, e.clientX, e.clientY);
      if (!deg) return;
      d.totalDeg += deg;
      // MPR "rotate the section you're on", tile edition: spin the stack in-plane about
      // its own view normal — every tile turns together (same clockwise convention), the
      // cutting planes don't move in space, so the scout image and its lines stay put.
      setBasis((b) => {
        const a = handOf(b) > 0 ? -deg : deg;
        return { u: rotV(b.u, b.n, a), v: rotV(b.v, b.n, a), n: b.n };
      });
      setChip(`rotating ${d.totalDeg >= 0 ? '+' : ''}${d.totalDeg.toFixed(0)}°`);
    }
  };

  const onDragEnd = () => {
    dragRef.current = null;
    setChip(null);
  };

  // tiles: right-drag anywhere on the stack = in-plane spin (left button stays free)
  const onTilesDown = (e: React.PointerEvent) => {
    if (!entry || e.button !== 2) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    // sweep around the grabbed tile's center (each tile shows the rotation axis at its
    // raster center); a down on the grid gap falls back to the whole-stack center
    const hit = canvasRefs.current.find((c) => {
      if (!c) return false;
      const r = c.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    const r = (hit ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
    dragRef.current = {
      kind: 'tile-rotate',
      lastX: e.clientX,
      lastY: e.clientY,
      totalDeg: 0,
      px: r.left + r.width / 2,
      py: r.top + r.height / 2,
    };
    setChip('rotating 0°');
  };

  // wheel steps the whole window one spacing unit
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !entry) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      setCenterOff((o) => clampOff(o + dir * stepVox));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [entry, stepVox, clampOff]);

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '3px 9px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent-dim)' : 'var(--panel-2)',
    color: 'var(--text)',
    fontSize: 12,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', gap: 4 }}>
          {(['axial', 'sagittal', 'coronal'] as Plane[]).map((p) => (
            <button
              key={p}
              style={btn(plane === p)}
              onClick={() => {
                setPlane(p);
                resetOrientation(p);
              }}
            >
              {p}
            </button>
          ))}
        </span>
        <span style={{ display: 'flex', gap: 4 }}>
          {Object.keys(GRIDS).map((g) => (
            <button key={g} style={btn(gridKey === g)} onClick={() => setGridKey(g)}>
              {g}
            </button>
          ))}
        </span>
        <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          spacing {spacingMm.toFixed(1)} mm{' '}
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.5}
            value={spacingMm}
            onChange={(e) => setSpacingMm(Number(e.target.value))}
            style={{ verticalAlign: 'middle', width: 90 }}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          thickness {thickMm.toFixed(1)} mm{' '}
          <input
            type="range"
            min={0.1}
            max={10}
            step={0.1}
            value={thickMm}
            onChange={(e) => setThickMm(Number(e.target.value))}
            style={{ verticalAlign: 'middle', width: 90 }}
          />
        </label>
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12 }}>
          <input type="checkbox" checked={mip} onChange={(e) => setMip(e.target.checked)} />
          MIP
        </label>
        <button
          style={{ ...btn(false), fontSize: 14, lineHeight: 1 }}
          onClick={() => resetOrientation(plane)}
          title="reset view — back to the straight orthogonal stack, window recentered"
        >
          ↺
        </button>
        <button
          style={btn(false)}
          onClick={takeSnapshot}
          title="snapshot: save the grid layout (scout + all sections, marks included) as a PNG image"
        >
          📷 snapshot
        </button>
        {entry && (
          <label style={{ fontSize: 11, color: 'var(--text-dim)', flex: 1, minWidth: 150 }}>
            position{' '}
            <input
              type="range"
              min={-maxOff}
              max={maxOff}
              step={1}
              value={Math.round(clampOff(centerOff))}
              onChange={(e) => setCenterOff(Number(e.target.value))}
              style={{ verticalAlign: 'middle', width: 'calc(100% - 70px)' }}
            />
          </label>
        )}
      </div>

      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, display: 'flex', gap: 6, position: 'relative' }}>
        <div
          style={{
            flex: `0 0 ${scoutPct}%`,
            minWidth: 150,
            position: 'relative',
            background: 'var(--viewport-bg)',
            borderRadius: 4,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <canvas
            ref={refCanvasRef}
            onPointerDown={onScoutDown}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: 'crosshair', touchAction: 'none' }}
            title="scout — left-drag: move the section window · right-drag: rotate the image (grid re-cuts through the turned anatomy)"
          />
          <span
            style={{
              position: 'absolute',
              top: 4,
              left: 8,
              fontSize: 10,
              letterSpacing: 0.5,
              color: 'var(--text-dim)',
              textShadow: '0 1px 2px #000',
              pointerEvents: 'none',
            }}
          >
            {SCOUT_NAME[plane]} · left-drag = move window · right-drag = rotate
          </span>
        </div>
        {/* draggable scout|stack pane line (always visible; double-click = default width) */}
        <DragDivider
          cursor="col-resize"
          title="drag: resize the scout · double-click: default width"
          style={{ flex: 'none', alignSelf: 'stretch', width: 8, borderRadius: 4 }}
          onMove={(x) => {
            const w = wrapRef.current;
            if (!w) return;
            const r = w.getBoundingClientRect();
            const next = clampScoutPct(((x - r.left) / r.width) * 100);
            scoutPctRef.current = next; // write-through: persist on release must not lag a batched render
            setScoutPct(next);
          }}
          onEnd={persistScoutPct}
          onReset={() => {
            scoutPctRef.current = SCOUT_PCT_DEFAULT;
            setScoutPct(SCOUT_PCT_DEFAULT);
            persistScoutPct();
          }}
        />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
            gap: 4,
            touchAction: 'none',
          }}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={onTilesDown}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          {offsets.map((off, k) => (
            <div key={k} style={{ position: 'relative', minHeight: 0, minWidth: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
              <canvas
                ref={(el) => {
                  canvasRefs.current[k] = el;
                }}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              />
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  left: 6,
                  fontSize: 10,
                  color: 'var(--text-dim)',
                  textShadow: '0 1px 2px #000',
                  fontVariantNumeric: 'tabular-nums',
                  pointerEvents: 'none',
                }}
              >
                {(off * voxMm).toFixed(1)} mm
              </span>
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  right: 6,
                  fontSize: 10,
                  fontWeight: 600,
                  color: LINE_COLOR,
                  textShadow: '0 1px 2px #000',
                  fontVariantNumeric: 'tabular-nums',
                  pointerEvents: 'none',
                }}
              >
                {k + 1}
              </span>
            </div>
          ))}
        </div>
        {chip && (
          <span
            style={{
              position: 'absolute',
              top: 8,
              left: '28%',
              zIndex: 2,
              padding: '2px 8px',
              borderRadius: 4,
              background: 'rgba(20,23,29,0.92)',
              border: '1px solid var(--border)',
              fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--text)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {chip} · ↺ = straight stack
          </span>
        )}
        {progress !== null && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(12,14,18,0.82)',
              color: 'var(--text-dim)',
              zIndex: 3,
              borderRadius: 4,
            }}
          >
            loading volume… {Math.round((progress ?? 0) * 100)}%
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        scout: left-drag = move the window · right-drag = rotate (grid re-cuts obliquely) · tiles:
        right-drag = rotate the sections in-plane · wheel = step · {count} parallel {plane} slices ·
        every {(stepVox * voxMm).toFixed(1)} mm · slab {(slabVox * voxMm).toFixed(1)} mm{' '}
        {mip ? 'MIP' : 'average'}
      </div>
    </div>
  );
}
