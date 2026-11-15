'use client';
// TMJ module: read BOTH condyles side by side, each in
// sections corrected to its own axis. On the axial scout the reader drags one line per
// condyle along the long axis of the condylar head (the two heads never align with the
// straight sagittal/coronal planes — that is the whole point of the module). Each side then
// gets a fan of thin sections either PERPENDICULAR to its axis (corrected sagittal — the
// classic TMJ read) or PARALLEL to it (corrected coronal). "Sync sides" mirrors one line to
// the other side about the midline. Pure canvas off the shared HU cache, sibling of CbctPano.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadVolumeData, type CbctMeta, type VolumeEntry } from './volumeData';
import { axialSlice, drawImage, renderLineSection, type ZRange } from './curvedReformat';
import { snapshotPaneCanvases, type SnapRef } from './SnapshotButton';
import { sweepDeg } from './CbctGrid';
import { VertRangeSliders } from './CbctPano';
import DragDivider from './DragDivider';
import { PANE_DIRECTION, paneIndexFromBuffer, sliceOrdinal } from './geometry';
import { ActiveFrame, PaneLabel, WlReadout, useActivePane } from './PaneOverlay';
import { PLANE_COLOR, drawHaloLabel } from './overlayGrammar';
import { initialAxialIndex, setAxialLevel } from './readingPlace';

interface Props {
  anon: string;
  voi: { center: number; width: number } | null;
  invert: boolean;
  gamma: number;
  onMeta?: (meta: CbctMeta) => void;
  onError?: (msg: string) => void;
  /** the shell's one snapshot button calls the registered composer */
  snapRef?: SnapRef;
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
const SLAB_GUIDE = 'rgba(70,220,95,0.95)'; // sampled-band outline — same green as pano/reslice
const SLAB_GUIDE_DIM = 'rgba(70,220,95,0.5)'; // per-section cut marks inside the band

interface Persisted {
  lines: Partial<Record<Side, AxisLine>>;
  z: number;
  /** the lines as DRAWN — exploratory nudges don't move it; "Reset lines" restores it (additive, pano's arch-home) */
  home?: Partial<Record<Side, AxisLine>>;
}

function loadPersisted(anon: string): Persisted | null {
  try {
    const raw = localStorage.getItem(TMJ_KEY(anon));
    if (!raw) return null;
    const p = JSON.parse(raw) as Persisted;
    const ok = (l?: AxisLine) =>
      !l || (Array.isArray(l.a) && Array.isArray(l.b) && [...l.a, ...l.b].every(Number.isFinite));
    return ok(p.lines?.R) && ok(p.lines?.L) && ok(p.home?.R) && ok(p.home?.L) ? p : null;
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

export default function CbctTmj({ anon, voi, invert, gamma, onMeta, onError, snapRef }: Props) {
  const [entry, setEntry] = useState<VolumeEntry | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [z, setZ] = useState(0);
  // the scout's level is the tab's reading place (./readingPlace): set from it on open, written back on every move
  const loadedAnonRef = useRef<string | null>(null);
  const { active: activePane, bind: bindPane } = useActivePane<'axial' | 'R' | 'L'>('axial');
  const [lines, setLines] = useState<Partial<Record<Side, AxisLine>>>({});
  const [sync, setSync] = useState(false);
  const [nSec, setNSec] = useState(5);
  const [secSpacing, setSecSpacing] = useState(2.5);
  const [secWidth, setSecWidth] = useState(34);
  const [secThickness, setSecThickness] = useState(0.5);
  const [mode, setMode] = useState<'perp' | 'para'>('perp');
  const [zFrac, setZFrac] = useState<[number, number]>([0.25, 1]);
  const [draft, setDraft] = useState<AxisLine | null>(null); // line being drawn
  // the lines as DRAWN — a fresh draw sets it; endpoint/whole-line nudges don't (pano's arch-home)
  const [linesHome, setLinesHome] = useState<Partial<Record<Side, AxisLine>>>({});
  // Fan rotation : the MPR/grid right-drag, TMJ edition — one in-plane tilt
  // PER SIDE (each condyle's fan spins on its own). The scout stays upright: one scout
  // serves two independent sides, so an oblique re-cut can't be right for both. A tilted
  // side's band dashes instead (exact shadow — see the axial draw effect).
  const [tilt, setTilt] = useState<Record<Side, number>>({ R: 0, L: 0 });
  const [rotChip, setRotChip] = useState<string | null>(null); // live drag readout
  const [leftFrac, setLeftFrac] = useState(0.34); // scout | sections split
  const [rowFrac, setRowFrac] = useState(0.5); // RIGHT row | LEFT row split

  const axialCv = useRef<HTMLCanvasElement | null>(null);
  const sectionCvs = useRef<Record<Side, (HTMLCanvasElement | null)[]>>({ R: [], L: [] });
  const gridRef = useRef<HTMLDivElement | null>(null);
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const rotRef = useRef<{ side: Side; lastX: number; lastY: number; px: number; py: number; totalDeg: number; tilt0: number } | null>(null);
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
    setLinesHome({});
    setTilt({ R: 0, L: 0 });
    setDraft(null);
    loadVolumeData(anon, (f) => !stale && setProgress(Math.min(0.95, f)))
      .then((e) => {
        if (stale) return;
        setEntry(e);
        onMeta?.(e.meta);
        const saved = loadPersisted(anon);
        setLines(saved?.lines ?? {});
        // pre-home records: the saved lines double as home on first load
        setLinesHome(saved?.home ?? saved?.lines ?? {});
        // condyles live in the upper part of a head volume — start the scout there
        loadedAnonRef.current = anon;
        setZ(initialAxialIndex(anon, e.meta, saved?.z ?? Math.round(e.meta.dims[2] * 0.72)));
        setProgress(null);
      })
      .catch((err) => {
        console.error('[cbct-tmj] load failed', err);
        if (!stale) {
          setProgress(null);
          onError?.('volume load failed: see the console');
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
        localStorage.setItem(TMJ_KEY(anon), JSON.stringify({ lines, z, home: linesHome }));
      } catch {
        /* storage full */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [lines, z, anon, entry, linesHome]);

  const effVoi = useMemo(
    () => voi ?? entry?.meta.defaultVoi ?? { center: 300, width: 2500 },
    [voi, entry],
  );
  useEffect(() => {
    if (entry && loadedAnonRef.current === anon) setAxialLevel(anon, entry.meta, z);
  }, [entry, z, anon]);
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

  /** Commit a freshly DRAWN line to a side. Home keeps the REPLACED line as the recovery
   *  point (one-step undo): a stray draw over a placed line must not overwrite the only
   *  path back — "Reset lines" restores the previous placement. A side's FIRST line
   *  anchors its own home; nudges afterwards don't move home.
   *  Sync gate: a fresh draw mirrors only into an EMPTY other side —
   *  replacing the far condyle's placed line from a stroke on THIS side is exactly how a
   *  stray draw wiped both sides at once. Deliberate synced editing stays live on
   *  endpoint/whole-line drags, which require grabbing an existing line. */
  const commitLine = useCallback(
    (l: AxisLine) => {
      const cx = (l.a[0] + l.b[0]) / 2;
      const side: Side = cx < midX ? 'R' : 'L'; // LPS: +x = patient LEFT ⇒ low x = RIGHT
      const other: Side = side === 'R' ? 'L' : 'R';
      const fillOther = sync && !lines[other];
      setLinesHome((home) => {
        const next = { ...home };
        next[side] = lines[side] ?? l;
        if (fillOther) next[other] = mirrorLine(l);
        return next;
      });
      setLines((cur) => {
        const next = { ...cur, [side]: l };
        if (fillOther) next[other] = mirrorLine(l);
        return next;
      });
    },
    [midX, sync, mirrorLine, lines],
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
    drawImage(cv, img, effVoi, invert, gamma);
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
      if (label) drawHaloLabel(ctx, label, (x1 + x2) / 2 + 8, (y1 + y2) / 2 - 8, color);
    };
    // per side: green sampled-band outline (exactly what the fan cuts — the pano slab-guide,
    // TMJ edition) + per-section cut marks inside it. A tilted side keeps its band as the
    // EXACT axial shadow of the rotated window: the width component shrinks by cosθ while
    // the kept z-band leans in by sinθ — dashed to say "out of plane" (drift dashes, never
    // mislocates). Cut marks hide while tilted (their per-slice positions no longer hold).
    const spzMm = entry.meta.spacing[2];
    const bandHalfMm = ((zRange.zHi - zRange.zLo + 1) * spzMm) / 2;
    for (const side of ['R', 'L'] as Side[]) {
      const g = sideGeom(side);
      const l = lines[side];
      if (!g || !l) continue;
      // perp: centers step ALONG the axis, planes ⊥ axis (columns along p)
      // para: centers step along p, planes ∥ axis (columns along d)
      const stepDir = mode === 'perp' ? g.d : g.p;
      const colDir = mode === 'perp' ? g.p : g.d;
      const th = (tilt[side] * Math.PI) / 180;
      const sideTilted = Math.abs(tilt[side]) > 0.01;
      const hs = ((nSec - 1) * secSpacing + secThickness) / 2; // marched span + slab, along stepDir
      const hw = sideTilted
        ? (secWidth / 2) * Math.abs(Math.cos(th)) + bandHalfMm * Math.abs(Math.sin(th))
        : secWidth / 2;
      const corner = (a: number, b: number): [number, number] => [
        (g.mid[0] + colDir[0] * a + stepDir[0] * b) / img.pxW,
        (g.mid[1] + colDir[1] * a + stepDir[1] * b) / img.pxH,
      ];
      ctx.strokeStyle = SLAB_GUIDE;
      ctx.lineWidth = 1;
      ctx.setLineDash(sideTilted ? [7, 5] : []);
      const cs: [number, number][] = [corner(-hw, -hs), corner(hw, -hs), corner(hw, hs), corner(-hw, hs)];
      ctx.beginPath();
      cs.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      if (!sideTilted) {
        ctx.strokeStyle = SLAB_GUIDE_DIM;
        ctx.lineWidth = 1;
        const tickHalf = hw / img.pxW; // cut marks span the exact sampled width
        for (let k = 0; k < nSec; k++) {
          const off = (k - (nSec - 1) / 2) * secSpacing;
          const cx = (g.mid[0] + stepDir[0] * off) / img.pxW;
          const cy = (g.mid[1] + stepDir[1] * off) / img.pxH;
          ctx.beginPath();
          ctx.moveTo(cx - colDir[0] * tickHalf, cy - colDir[1] * tickHalf);
          ctx.lineTo(cx + colDir[0] * tickHalf, cy + colDir[1] * tickHalf);
          ctx.stroke();
        }
      }
      drawLine(l, SIDE_COLOR[side], side);
    }
    if (draft) drawLine(draft, 'rgba(255,255,255,0.85)', null);
  }, [entry, z, effVoi, invert, gamma, lines, draft, sideGeom, nSec, secSpacing, secWidth, secThickness, mode, zRange, tilt]);

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
          tiltDeg: tilt[side],
        });
        drawImage(cv, img, effVoi, invert, gamma);
        const ctx = cv.getContext('2d')!;
        ctx.strokeStyle = MARKER_DIM;
        ctx.beginPath();
        ctx.moveTo(img.width / 2, 0);
        ctx.lineTo(img.width / 2, img.height);
        ctx.stroke();
        const sideTilted = Math.abs(tilt[side]) > 0.01;
        // orientation letters at the edge midpoints, only while upright: an in-plane spin
        // mixes them with S and I
        if (!sideTilted) {
          const [lo, hi] = mode === 'perp' ? ['A', 'P'] : side === 'R' ? ['lat', 'med'] : ['med', 'lat'];
          drawHaloLabel(ctx, lo, 0, img.height / 2, '#e6e9ef');
          drawHaloLabel(ctx, hi, img.width, img.height / 2, '#e6e9ef');
        }
      }
    }
  }, [entry, sideGeom, nSec, secSpacing, secWidth, secThickness, mode, zRange, effVoi, invert, gamma, lines, tilt]);

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

  // ---- fan rotation: the MPR/grid right-drag on any tile spins that SIDE's whole fan.
  // The line stays valid AND editable while tilted — in ⊥ mode the spin is about the axis
  // line itself, and the tilt is defined in the line's own frame either way.
  const onTileDown = (side: Side) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!lines[side] || e.button !== 2) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    rotRef.current = {
      side,
      lastX: e.clientX,
      lastY: e.clientY,
      px: r.left + r.width / 2,
      py: r.top + r.height / 2,
      totalDeg: 0,
      tilt0: tilt[side],
    };
    setRotChip(`${side} tilt ${tilt[side] >= 0 ? '+' : ''}${tilt[side].toFixed(0)}°`);
  };
  const onTileMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rot = rotRef.current;
    if (!rot) return;
    const deg = sweepDeg(rot.px, rot.py, rot.lastX, rot.lastY, e.clientX, e.clientY);
    rot.lastX = e.clientX;
    rot.lastY = e.clientY;
    if (!deg) return;
    rot.totalDeg += deg;
    const next = rot.tilt0 + rot.totalDeg;
    setTilt((cur) => ({ ...cur, [rot.side]: next }));
    setRotChip(`${rot.side} tilt ${next >= 0 ? '+' : ''}${next.toFixed(0)}°`);
  };
  const onTileUp = () => {
    if (rotRef.current) {
      rotRef.current = null;
      setRotChip(null);
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

  const small: React.CSSProperties = { fontSize: 'var(--fs-meta)', color: 'var(--text-dim)', whiteSpace: 'nowrap' };
  const captionStrip: React.CSSProperties = {
    ...small,
    lineHeight: '20px',
    height: 20,
    flex: '0 0 auto',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontVariantNumeric: 'tabular-nums',
  };
  const sliderRow: React.CSSProperties = {
    display: 'flex',
    gap: 'var(--sp-2)',
    alignItems: 'center',
    padding: 'var(--sp-1) 0',
    flexWrap: 'wrap',
    fontVariantNumeric: 'tabular-nums',
  };

  // one snapshot door: the shell header owns the button; this room registers its composer
  useEffect(() => {
    if (!snapRef) return;
    snapRef.current = () =>
      void snapshotPaneCanvases(
        gridRef.current,
        `${anon} · tmj · ${new Date().toISOString().slice(0, 10)}`,
        `${anon}_tmj.png`,
      );
  });
  useEffect(() => {
    if (!snapRef) return;
    return () => {
      snapRef.current = null;
    };
  }, [snapRef]);

  const sideRow = (side: Side) => {
    const sideTilted = Math.abs(tilt[side]) > 0.01;
    return (
    <div key={side} {...bindPane(side)} style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <ActiveFrame on={activePane === side} />
      {/* the side and each section's caption sit in strips above the images */}
      <div data-snap-caption style={{ ...captionStrip, color: SIDE_COLOR[side], fontWeight: 600 }}>
        {side === 'R' ? 'Right condyle' : 'Left condyle'}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {Array.from({ length: nSec }, (_, k) => {
          const off = (k - (nSec - 1) / 2) * secSpacing;
          return (
            <div key={k} data-snap-caption style={{ ...captionStrip, flex: 1, minWidth: 0, color: 'var(--text)' }}>
              {side}
              {k + 1} {off > 0 ? '+' : ''}
              {off.toFixed(1)} mm{sideTilted ? `, ${tilt[side] >= 0 ? '+' : ''}${tilt[side].toFixed(0)}°` : ''}
            </div>
          );
        })}
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', gap: 6 }}>
      {Array.from({ length: nSec }, (_, k) => {
        return (
        <div
          key={k}
          onPointerDown={onTileDown(side)}
          onPointerMove={onTileMove}
          onPointerUp={onTileUp}
          onPointerCancel={onTileUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{ position: 'relative', flex: 1, minWidth: 0, background: 'var(--viewport-bg)', borderRadius: 4, touchAction: 'none' }}
        >
          <canvas
            ref={(el) => {
              sectionCvs.current[side][k] = el;
            }}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
          {lines[side] && k === nSec - 1 && <WlReadout voi={effVoi} />}
        </div>
        );
      })}
      {!lines[side] && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-dim)',
            fontSize: 'var(--fs-meta)',
            pointerEvents: 'none',
          }}
        >
          Drag a line along the {side === 'R' ? 'right' : 'left'} condyle head on the axial scout
        </div>
      )}
      </div>
    </div>
    );
  };

  return (
    <div
      ref={gridRef}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: `minmax(280px, ${(leftFrac * 100).toFixed(2)}%) 6px 1fr`,
        gap: 8,
        width: '100%',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* left: axial scout + controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
        <div {...bindPane('axial')} style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
          <ActiveFrame on={activePane === 'axial'} />
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
          {/* plane and slice only: the gestures live in the Keys card and the status line */}
          <PaneLabel
            name="AXIAL"
            color={PLANE_COLOR.axial}
            slice={entry ? sliceOrdinal(paneIndexFromBuffer('axial', z, slices), slices, PANE_DIRECTION.axial) : undefined}
          />
          <WlReadout voi={entry ? effVoi : null} />
          <input
            className="vslice"
            type="range"
            min={0}
            max={Math.max(0, slices - 1)}
            step={1}
            value={z}
            onChange={(e) => setZ(Number(e.target.value))}
            onDoubleClick={() => setZ(Math.floor(slices / 2))}
            onPointerDown={(e) => e.stopPropagation()}
            title="Scout slice, up is superior. Double-click: volume middle."
            aria-label="Axial slice"
            data-overlay="slider"
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
            type="button"
            className="ctl"
            aria-pressed={mode === 'perp'}
            title="Sections perpendicular to each condyle's axis (corrected sagittal, the classic TMJ read)"
            onClick={() => setMode('perp')}
          >
            Perpendicular
          </button>
          <button
            type="button"
            className="ctl"
            aria-pressed={mode === 'para'}
            title="Sections parallel to each condyle's axis (corrected coronal)"
            onClick={() => setMode('para')}
          >
            Parallel
          </button>
          <label className="mode-check" title="Editing one side mirrors the line to the other about the midline; a fresh draw fills the other side only if it is empty, and never replaces a placed line there">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> Sync sides
          </label>
          <button
            type="button"
            className="ctl"
            disabled={!lines.R && !lines.L}
            title={!lines.R && !lines.L ? 'No axis line to clear yet' : 'Delete both axis lines (and their saved home)'}
            onClick={() => {
              setLines({});
              setLinesHome({});
              setTilt({ R: 0, L: 0 });
            }}
          >
            Clear lines
          </button>
          <button
            type="button"
            className="ctl"
            disabled={!linesHome.R && !linesHome.L}
            title={
              !linesHome.R && !linesHome.L
                ? 'Nothing to reset: draw an axis line first'
                : "Restore both axis lines to where they were drawn. Exploratory nudges roll back (the pano's Reset arch)"
            }
            onClick={() => setLines({ ...linesHome })}
          >
            Reset lines
          </button>
        </div>
        <div className="mode-note">
          Drag one line along each condyle head, from the lateral pole to the medial pole. Sections are cut
          against each side&apos;s own axis, so the joint is read in its own plane, not the
          scanner&apos;s. Perpendicular is corrected sagittal; Parallel is corrected coronal.
        </div>
      </div>

      {/* draggable divider: scout and sections */}
      <DragDivider
        cursor="col-resize"
        title="Drag to resize the scout against the sections. Double-click resets."
        style={{ borderRadius: 3, alignSelf: 'stretch' }}
        onMove={(clientX) => {
          const r = gridRef.current?.getBoundingClientRect();
          if (!r || !r.width) return;
          setLeftFrac(Math.min(0.6, Math.max(0.18, (clientX - r.left) / r.width)));
        }}
        onReset={() => setLeftFrac(0.34)}
      />

      {/* right: RIGHT condyle row over LEFT condyle row (draggable split, crop handles on
          the shared right edge — pano-style) + shared section controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, minWidth: 0 }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 4 }}>
          <div
            ref={rowsRef}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: 'grid',
              gridTemplateRows: `minmax(60px, ${(rowFrac * 100).toFixed(2)}%) 6px 1fr`,
              gap: 4,
              position: 'relative',
            }}
          >
            {sideRow('R')}
            <DragDivider
              cursor="row-resize"
              title="Drag to resize the right condyle row against the left. Double-click resets."
              style={{ borderRadius: 3 }}
              onMove={(_x, clientY) => {
                const r = rowsRef.current?.getBoundingClientRect();
                if (!r || !r.height) return;
                setRowFrac(Math.min(0.8, Math.max(0.2, (clientY - r.top) / r.height)));
              }}
              onReset={() => setRowFrac(0.5)}
            />
            {sideRow('L')}
            {rotChip && (
              <span
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 8,
                  fontSize: 'var(--fs-meta)',
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text)',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--ctl-radius)',
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
          <label className="mode-label" title="Odd counts only, so one section stays exactly on the condyle axis">
            Sections {nSec}
            <input
              type="range"
              min={3}
              max={9}
              step={2}
              value={nSec}
              onChange={(e) => setNSec(Number(e.target.value))}
              onDoubleClick={() => setNSec(5)}
              style={{ width: 70 }}
            />
          </label>
          {/* canonical section-row order: count, tilt, spacing,
              width, thickness. Same anatomy in Pano and Reslice. */}
          <span style={small} title="Right-drag on any tile rotates that side's whole fan in-plane (MPR gesture)">
            Tilt R {tilt.R >= 0 ? '+' : ''}{tilt.R.toFixed(0)}°, L {tilt.L >= 0 ? '+' : ''}{tilt.L.toFixed(0)}°
          </span>
          <button
            type="button"
            className="ctl"
            disabled={Math.abs(tilt.R) <= 0.01 && Math.abs(tilt.L) <= 0.01}
            title={
              Math.abs(tilt.R) > 0.01 || Math.abs(tilt.L) > 0.01
                ? 'Both fans back upright (0°)'
                : 'Already upright: right-drag a tile to tilt its fan'
            }
            onClick={() => setTilt({ R: 0, L: 0 })}
          >
            Upright
          </button>
          <label className="mode-label" style={{ flex: 1 }}>
            Spacing {secSpacing.toFixed(1)} mm
            <input
              type="range"
              min={0.5}
              max={6}
              step={0.5}
              value={secSpacing}
              onChange={(e) => setSecSpacing(Number(e.target.value))}
              onDoubleClick={() => setSecSpacing(2.5)}
              style={{ flex: 1, minWidth: 0 }}
            />
          </label>
          <label className="mode-label" style={{ flex: 1 }}>
            Width {secWidth} mm
            <input
              type="range"
              min={16}
              max={60}
              step={2}
              value={secWidth}
              onChange={(e) => setSecWidth(Number(e.target.value))}
              onDoubleClick={() => setSecWidth(34)}
              style={{ flex: 1, minWidth: 0 }}
            />
          </label>
          <label className="mode-label" style={{ flex: 1 }} title="Average this many mm across each section, for a thicker, quieter cut">
            Thickness {secThickness.toFixed(1)} mm
            <input
              type="range"
              min={0}
              max={6}
              step={0.5}
              value={secThickness}
              onChange={(e) => setSecThickness(Number(e.target.value))}
              onDoubleClick={() => setSecThickness(0.5)}
              style={{ flex: 1, minWidth: 0 }}
            />
          </label>
        </div>
        <div style={sliderRow}>
          <span style={small} title="Crop the sections vertically with the handles at the right edge of the sections">
            Vertical range {Math.round(zFrac[0] * 100)} to {Math.round(zFrac[1] * 100)}%
          </span>
          <button
            type="button"
            className="ctl"
            disabled={!entry}
            title="Reset the reading position: both fans upright and the condyle-default vertical range (lines, section settings, and pane splits untouched)"
            onClick={() => {
              setTilt({ R: 0, L: 0 });
              setZFrac([0.25, 1]);
            }}
          >
            Reset position
          </button>
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
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          Loading volume… {Math.round((progress ?? 0) * 100)}%
        </div>
      )}
    </div>
  );
}
