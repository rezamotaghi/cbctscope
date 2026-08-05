'use client';
// Region growing + airway . The reader draws a bounding box
// on the axial scout, picks a density preset (air / soft / bone / tooth) or a manual HU range,
// then clicks a seed inside the target: every connected voxel in range floods out (bounded by
// the box) into a mask shown over all three orthogonal planes. The panel reports volume,
// HU stats, and the per-height cross-sectional area profile with the narrowest slice flagged —
// the airway read. Pure canvas off the shared HU cache; the fill runs in regionGrow.ts.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadVolumeData, type CbctMeta, type VolumeEntry } from './volumeData';
import { toImageData } from './curvedReformat';
import { growRegion, HU_PRESETS, type GrowResult, type GrowBox } from './regionGrow';
import { VertRangeSliders } from './CbctPano';
import DragDivider from './DragDivider';
import { snapshotPaneCanvases, type SnapRef } from './SnapshotButton';

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

const MASK_RGB: [number, number, number] = [76, 220, 140]; // green mask
const BOX_COLOR = 'rgba(120,200,255,0.9)';
const SEED_COLOR = 'rgba(255,95,95,0.95)';
const BAND_GUIDE = 'rgba(70,220,95,0.95)'; // the kept z-band lines — same green as the other panes
const HANDLE_R = 8; // corner-handle hit radius, data px

type Plane = 'axial' | 'sagittal' | 'coronal';

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

export default function CbctRegion({ anon, voi, invert, gamma, onMeta, onError, snapRef }: Props) {
  const [entry, setEntry] = useState<VolumeEntry | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [axialZ, setAxialZ] = useState(0);
  const [presetKey, setPresetKey] = useState<string>('air');
  const [lo, setLo] = useState(-1024);
  const [hi, setHi] = useState(-400);
  const [smooth, setSmooth] = useState(false);
  // the grow's vertical bounds as fractions of the z extent — the two range handles right of
  // the planes (asymmetric by design: "choana down to epiglottis", not ±N around the seed)
  const [zFrac, setZFrac] = useState<[number, number]>([0, 1]);
  const [box2d, setBox2d] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null); // voxel x,y rect, normalized
  const [seed, setSeed] = useState<[number, number, number] | null>(null);
  const [result, setResult] = useState<GrowResult | null>(null);
  const [busy, setBusy] = useState(false);
  // recoverable seed states (outside range / box / HU) — an inline hint, NEVER onError:
  // the host treats onError as fatal and replaces the whole pane, hiding the very
  // controls (range handles, box) the reader needs to recover with
  const [hint, setHint] = useState<string | null>(null);
  const [leftFrac, setLeftFrac] = useState(0.42); // scout | planes split
  const [sagFrac, setSagFrac] = useState(0.5); // sagittal | coronal split

  const axialCv = useRef<HTMLCanvasElement | null>(null);
  const sagCv = useRef<HTMLCanvasElement | null>(null);
  const corCv = useRef<HTMLCanvasElement | null>(null);
  const areaCv = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const planesRef = useRef<HTMLDivElement | null>(null);
  const boxDraft = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  // box lifecycle: a finished box is editable — corners resize (anchor = the opposite
  // corner), the inside drags the whole box, a click inside still drops the seed
  const dragRef = useRef<
    | { kind: 'draw' }
    | { kind: 'resize'; ax: number; ay: number }
    | { kind: 'move'; offX: number; offY: number; w: number; h: number; sx: number; sy: number }
    | null
  >(null);

  useEffect(() => {
    let stale = false;
    setEntry(null);
    setProgress(0);
    setBox2d(null);
    setSeed(null);
    setResult(null);
    loadVolumeData(anon, (f) => !stale && setProgress(Math.min(0.95, f)))
      .then((e) => {
        if (stale) return;
        setEntry(e);
        onMeta?.(e.meta);
        setAxialZ(Math.round(e.meta.dims[2] * 0.5));
        setProgress(null);
      })
      .catch((err) => {
        console.error('[cbct-region] load failed', err);
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

  const effVoi = useMemo(() => voi ?? entry?.meta.defaultVoi ?? { center: 300, width: 2500 }, [voi, entry]);
  const dims = entry?.meta.dims ?? [1, 1, 1];
  const [nx, ny, nz] = dims;

  // last preset actually chosen — the dbl-click reset target for a hand-detuned lo/hi
  // (manual slider moves clear presetKey for honesty, which would orphan the reset)
  const lastPreset = useRef('air');
  const applyPreset = (key: string) => {
    setPresetKey(key);
    const p = HU_PRESETS[key];
    if (p) {
      lastPreset.current = key;
      setLo(p.lo);
      setHi(p.hi);
    }
  };

  // the 3D box: drawn x,y rect (or whole slice) × the explicit z window from the range handles
  const growBox = useCallback((): GrowBox => {
    const r = box2d ?? { x0: 0, y0: 0, x1: nx - 1, y1: ny - 1 };
    const zA = Math.round(zFrac[0] * (nz - 1));
    const zB = Math.round(zFrac[1] * (nz - 1));
    return {
      x0: Math.min(r.x0, r.x1),
      x1: Math.max(r.x0, r.x1),
      y0: Math.min(r.y0, r.y1),
      y1: Math.max(r.y0, r.y1),
      z0: Math.min(zA, zB),
      z1: Math.max(zA, zB),
    };
  }, [box2d, nx, ny, nz, zFrac]);

  // recompute the grow whenever the inputs change (seed set)
  useEffect(() => {
    if (!entry || !seed) {
      setResult(null);
      setHint(null);
      setBusy(false); // a cleared seed can cancel the debounce timer before its finally runs — unlatch here
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      try {
        const box = growBox();
        if (seed[2] < box.z0 || seed[2] > box.z1) {
          setResult(null);
          setHint('the seed is outside the vertical range — pull the range handles to include it');
          return;
        }
        if (seed[0] < box.x0 || seed[0] > box.x1 || seed[1] < box.y0 || seed[1] > box.y1) {
          setResult(null);
          setHint('the seed is outside the box — click inside it, or clear the box');
          return;
        }
        const res = growRegion(entry, seed, Math.min(lo, hi), Math.max(lo, hi), box, smooth);
        setResult(res);
        setHint(res ? null : 'the seed voxel is outside the HU range — click on the target tissue, or widen the range');
      } catch (err) {
        // a grow-time crash is recoverable — the volume, box, and handles are intact;
        // a different seed/range typically works, so this must never nuke the pane
        console.error('[cbct-region] grow failed', err);
        setResult(null);
        setHint('region grow failed — try a different seed, a smaller box, or a narrower range');
      } finally {
        setBusy(false);
      }
    }, 60);
    return () => clearTimeout(t);
  }, [entry, seed, lo, hi, smooth, growBox]);

  // ---- render a plane (axial/sag/coronal) with the grayscale slice + mask overlay
  const renderPlane = useCallback(
    (plane: Plane, fixedIdx: number, cv: HTMLCanvasElement | null) => {
      if (!cv || !entry) return;
      const s = entry.scalar;
      let w: number, h: number;
      if (plane === 'axial') {
        w = nx;
        h = ny;
      } else if (plane === 'sagittal') {
        w = ny;
        h = nz;
      } else {
        w = nx;
        h = nz;
      }
      const data = new Int16Array(w * h);
      for (let r = 0; r < h; r++)
        for (let c = 0; c < w; c++) {
          let gx: number, gy: number, gz: number;
          if (plane === 'axial') {
            gx = c;
            gy = r;
            gz = fixedIdx;
          } else if (plane === 'sagittal') {
            gx = fixedIdx;
            gy = c;
            gz = nz - 1 - r;
          } else {
            gx = c;
            gy = fixedIdx;
            gz = nz - 1 - r;
          }
          data[r * w + c] = s[gz * ny * nx + gy * nx + gx];
        }
      const id = toImageData({ data, width: w, height: h }, effVoi, invert, gamma);
      // blend the mask where it exists on this plane
      if (result) {
        const { box, mask, bw, bh } = result;
        const px = id.data;
        for (let r = 0; r < h; r++)
          for (let c = 0; c < w; c++) {
            let gx: number, gy: number, gz: number;
            if (plane === 'axial') {
              gx = c;
              gy = r;
              gz = fixedIdx;
            } else if (plane === 'sagittal') {
              gx = fixedIdx;
              gy = c;
              gz = nz - 1 - r;
            } else {
              gx = c;
              gy = fixedIdx;
              gz = nz - 1 - r;
            }
            if (gx < box.x0 || gx > box.x1 || gy < box.y0 || gy > box.y1 || gz < box.z0 || gz > box.z1) continue;
            if (mask[(gz - box.z0) * bw * bh + (gy - box.y0) * bw + (gx - box.x0)]) {
              const o = (r * w + c) * 4;
              px[o] = Math.round(px[o] * 0.35 + MASK_RGB[0] * 0.65);
              px[o + 1] = Math.round(px[o + 1] * 0.35 + MASK_RGB[1] * 0.65);
              px[o + 2] = Math.round(px[o + 2] * 0.35 + MASK_RGB[2] * 0.65);
            }
          }
      }
      cv.width = w;
      cv.height = h;
      cv.getContext('2d')?.putImageData(id, 0, 0);
    },
    [entry, nx, ny, nz, effVoi, invert, gamma, result],
  );

  // axial: slice + box (with corner handles once finished) + seed marker + mask.
  // Extracted so the pointer handlers can repaint after a drag that changed no state.
  const drawAxial = useCallback(() => {
    const cv = axialCv.current;
    if (!cv || !entry) return;
    renderPlane('axial', axialZ, cv);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const r = boxDraft.current ?? box2d;
    if (r) {
      ctx.strokeStyle = BOX_COLOR;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
    }
    if (!boxDraft.current && box2d) {
      // finished box → visible corner handles (the resize affordance)
      const hs = 3.5;
      ctx.fillStyle = BOX_COLOR;
      for (const [cx, cy] of [
        [box2d.x0, box2d.y0],
        [box2d.x1, box2d.y0],
        [box2d.x1, box2d.y1],
        [box2d.x0, box2d.y1],
      ])
        ctx.fillRect(cx - hs, cy - hs, hs * 2, hs * 2);
    }
    if (seed && seed[2] === axialZ) {
      ctx.fillStyle = SEED_COLOR;
      ctx.beginPath();
      ctx.arc(seed[0], seed[1], 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [entry, axialZ, box2d, seed, renderPlane]);
  useEffect(() => {
    drawAxial();
  }, [drawAxial]);

  // sag/coronal through the seed
  useEffect(() => {
    if (!entry || !seed) {
      // no seed → blank panes; leaving the previous render up would show a mask that no longer exists
      for (const cv of [sagCv.current, corCv.current]) {
        const ctx = cv?.getContext('2d');
        if (cv && ctx) ctx.clearRect(0, 0, cv.width, cv.height);
      }
      return;
    }
    renderPlane('sagittal', seed[0], sagCv.current);
    renderPlane('coronal', seed[1], corCv.current);
    // the kept z-band — dashed green lines where the range handles bound the grow
    const zA = Math.round(zFrac[0] * (nz - 1));
    const zB = Math.round(zFrac[1] * (nz - 1));
    for (const cv of [sagCv.current, corCv.current]) {
      if (!cv) continue;
      const ctx = cv.getContext('2d');
      if (!ctx) continue;
      ctx.strokeStyle = BAND_GUIDE;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      for (const zv of [zA, zB]) {
        const yRow = nz - 1 - zv;
        ctx.beginPath();
        ctx.moveTo(0, yRow);
        ctx.lineTo(cv.width, yRow);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // narrowest-z line
    if (result && result.narrowestZ >= 0) {
      for (const cv of [sagCv.current, corCv.current]) {
        if (!cv) continue;
        const ctx = cv.getContext('2d');
        if (!ctx) continue;
        const yRow = nz - 1 - result.narrowestZ;
        ctx.strokeStyle = 'rgba(255,180,60,0.9)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(0, yRow);
        ctx.lineTo(cv.width, yRow);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }, [entry, seed, result, renderPlane, nz, zFrac]);

  // area-vs-height profile graph
  useEffect(() => {
    const cv = areaCv.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = (cv.width = 220);
    const H = (cv.height = 90);
    ctx.fillStyle = 'rgba(20,23,29,1)';
    ctx.fillRect(0, 0, W, H);
    if (!result) return;
    const { areaByZ, box, narrowestZ } = result;
    let maxA = 0;
    for (let z = box.z0; z <= box.z1; z++) maxA = Math.max(maxA, areaByZ[z]);
    if (maxA <= 0) return;
    // x = z (inferior→superior left→right), y = area
    const zn = box.z1 - box.z0 + 1;
    ctx.strokeStyle = 'rgba(76,220,140,0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < zn; i++) {
      const z = box.z0 + i;
      const x = (i / Math.max(1, zn - 1)) * (W - 4) + 2;
      const y = H - 4 - (areaByZ[z] / maxA) * (H - 12);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (narrowestZ >= 0) {
      const x = ((narrowestZ - box.z0) / Math.max(1, zn - 1)) * (W - 4) + 2;
      ctx.strokeStyle = 'rgba(255,180,60,0.9)';
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x, H - 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#9aa3b2';
    ctx.font = '9px system-ui';
    ctx.fillText('inferior', 2, H - 1);
    ctx.fillText('superior', W - 44, H - 1);
  }, [result]);

  // ---- axial interactions: drag = box · click = seed · wheel = slice
  const axialVox = useCallback(
    (e: { clientX: number; clientY: number }): [number, number] | null => {
      const cv = axialCv.current;
      if (!cv) return null;
      const p = containPos(cv, e);
      return p ? [Math.round(p.x), Math.round(p.y)] : null;
    },
    [],
  );
  // corner index (0 TL · 1 TR · 2 BR · 3 BL) under the pointer, or -1
  const cornerAt = (b: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number): number => {
    const corners = [
      [b.x0, b.y0],
      [b.x1, b.y0],
      [b.x1, b.y1],
      [b.x0, b.y1],
    ];
    for (let i = 0; i < 4; i++)
      if (Math.abs(x - corners[i][0]) <= HANDLE_R && Math.abs(y - corners[i][1]) <= HANDLE_R) return i;
    return -1;
  };
  const insideBox = (b: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number) =>
    x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2;

  const onAxialDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const v = axialVox(e);
    if (!v) return;
    (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
    if (box2d) {
      const c = cornerAt(box2d, v[0], v[1]);
      if (c >= 0) {
        // resize: the grabbed corner follows the pointer, the opposite corner anchors
        const ax = c === 0 || c === 3 ? box2d.x1 : box2d.x0;
        const ay = c === 0 || c === 1 ? box2d.y1 : box2d.y0;
        dragRef.current = { kind: 'resize', ax, ay };
        boxDraft.current = { x0: ax, y0: ay, x1: v[0], y1: v[1] };
        return;
      }
      if (insideBox(box2d, v[0], v[1])) {
        dragRef.current = {
          kind: 'move',
          offX: v[0] - box2d.x0,
          offY: v[1] - box2d.y0,
          w: box2d.x1 - box2d.x0,
          h: box2d.y1 - box2d.y0,
          sx: v[0],
          sy: v[1],
        };
        boxDraft.current = { ...box2d };
        return;
      }
    }
    dragRef.current = { kind: 'draw' };
    boxDraft.current = { x0: v[0], y0: v[1], x1: v[0], y1: v[1] };
  };
  const onAxialMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const cv = axialCv.current;
    if (!drag) {
      // hover affordance: resize cursor on a corner, move cursor inside the box
      if (!cv) return;
      const v = axialVox(e);
      let cur = 'crosshair';
      if (v && box2d) {
        const c = cornerAt(box2d, v[0], v[1]);
        if (c >= 0) cur = c % 2 === 0 ? 'nwse-resize' : 'nesw-resize';
        else if (insideBox(box2d, v[0], v[1])) cur = 'move';
      }
      cv.style.cursor = cur;
      return;
    }
    if (!boxDraft.current) return;
    const v = axialVox(e);
    if (!v) return;
    if (drag.kind === 'move') {
      const x0 = Math.max(0, Math.min(nx - 1 - drag.w, v[0] - drag.offX));
      const y0 = Math.max(0, Math.min(ny - 1 - drag.h, v[1] - drag.offY));
      boxDraft.current = { x0, y0, x1: x0 + drag.w, y1: y0 + drag.h };
    } else if (drag.kind === 'resize') {
      boxDraft.current = { x0: drag.ax, y0: drag.ay, x1: v[0], y1: v[1] };
    } else {
      boxDraft.current = { ...boxDraft.current, x1: v[0], y1: v[1] };
    }
    if (cv && entry) {
      renderPlane('axial', axialZ, cv);
      const ctx = cv.getContext('2d');
      const r = boxDraft.current;
      if (ctx && r) {
        ctx.strokeStyle = BOX_COLOR;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
        if (seed && seed[2] === axialZ) {
          ctx.fillStyle = SEED_COLOR;
          ctx.beginPath();
          ctx.arc(seed[0], seed[1], 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  };
  const onAxialUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const r = boxDraft.current;
    boxDraft.current = null;
    if (!r) return;
    const norm = {
      x0: Math.min(r.x0, r.x1),
      y0: Math.min(r.y0, r.y1),
      x1: Math.max(r.x0, r.x1),
      y1: Math.max(r.y0, r.y1),
    };
    if (drag.kind === 'draw') {
      const area = (norm.x1 - norm.x0) * (norm.y1 - norm.y0);
      if (area > 25) {
        setBox2d(norm); // a real drag = set the bounding box
        return;
      }
      // a click = drop the seed here (in the current box, or whole slice) and grow
      const v = axialVox(e);
      if (v) setSeed([v[0], v[1], axialZ]);
      else drawAxial(); // nothing changed — erase the dot-sized draft stroke
      return;
    }
    if (drag.kind === 'move') {
      const v = axialVox(e);
      const moved = v ? (v[0] - drag.sx) ** 2 + (v[1] - drag.sy) ** 2 > 16 : true;
      if (moved) setBox2d(norm);
      else if (v) setSeed([v[0], v[1], axialZ]); // a click inside the box still seeds
      else drawAxial();
      return;
    }
    setBox2d(norm); // resize commits — regrow fires via the effect
  };
  const onAxialContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (box2d) setBox2d(null); // delete just the box — seed + mask regrow against the fallback bounds
  };
  useEffect(() => {
    const cv = axialCv.current;
    if (!cv || !entry) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      setAxialZ((z) => Math.max(0, Math.min(nz - 1, z + (ev.deltaY > 0 ? 1 : -1))));
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [entry, nz]);


  // one snapshot door: the shell header owns the button; this room registers its composer
  useEffect(() => {
    if (!snapRef) return;
    snapRef.current = () =>
      void snapshotPaneCanvases(
        rootRef.current,
        `${anon} · region · ${new Date().toISOString().slice(0, 10)}`,
        `${anon}_region.png`,
      );
  });
  useEffect(() => {
    if (!snapRef) return;
    return () => {
      snapRef.current = null;
    };
  }, [snapRef]);

  const chip = (active: boolean): React.CSSProperties => ({
    padding: '3px 8px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent-dim)' : 'var(--panel-2)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: 11,
  });
  const small: React.CSSProperties = { fontSize: 11, color: 'var(--text-dim)' };
  const stat = (label: string, value: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );

  return (
    <div
      ref={rootRef}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: `minmax(300px, ${(leftFrac * 100).toFixed(2)}%) 6px 1fr`,
        gap: 8,
        width: '100%',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* left: axial (box + seed) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
          <canvas
            ref={axialCv}
            onPointerDown={onAxialDown}
            onPointerMove={onAxialMove}
            onPointerUp={onAxialUp}
            onContextMenu={onAxialContext}
            style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'crosshair', touchAction: 'none', display: 'block' }}
          />
          <span style={{ position: 'absolute', top: 6, left: 8, ...small, pointerEvents: 'none' }}>
            AXIAL {entry ? `${axialZ + 1}/${nz}` : ''} · drag = box (corners resize · inside moves · right-click deletes) · click = seed · wheel = slice
          </span>
          <input
            className="vslice"
            type="range"
            min={0}
            max={Math.max(0, nz - 1)}
            step={1}
            value={axialZ}
            onChange={(e) => setAxialZ(Number(e.target.value))}
            onDoubleClick={() => setAxialZ(Math.round(nz * 0.5))}
            onPointerDown={(e) => e.stopPropagation()}
            title="scout slice · up = superior (S) · double-click = volume middle"
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '2px' }}>
          {Object.keys(HU_PRESETS).map((k) => (
            <button key={k} style={chip(presetKey === k)} title={`${HU_PRESETS[k].lo}…${HU_PRESETS[k].hi} HU`} onClick={() => applyPreset(k)}>
              {HU_PRESETS[k].label}
            </button>
          ))}
          <label
            style={{ ...small, display: 'flex', gap: 4, alignItems: 'center' }}
            title="morphological closing on the grown mask — fills pinholes and hairline gaps (slower)"
          >
            <input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} /> smooth
          </label>
          <button
            style={chip(false)}
            disabled={!box2d}
            title="delete the bounding box — the seed and mask stay, regrown against the whole slice footprint"
            onClick={() => setBox2d(null)}
          >
            clear box
          </button>
          <button
            style={chip(false)}
            disabled={!seed}
            title="clear the seed + mask — the box stays for the next seed"
            onClick={() => setSeed(null)}
          >
            clear seed
          </button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '2px', alignItems: 'center' }}>
          <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
            HU {lo}
            <input
              type="range"
              min={-1024}
              max={3000}
              step={10}
              value={lo}
              onChange={(e) => { setLo(Number(e.target.value)); setPresetKey(''); }}
              onDoubleClick={() => { setLo(HU_PRESETS[lastPreset.current].lo); setPresetKey(lastPreset.current); setHi(HU_PRESETS[lastPreset.current].hi); }}
              title="lower HU bound of the grow · double-click = back to the last preset"
              style={{ width: 90 }}
            />
          </label>
          <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
            – {hi}
            <input
              type="range"
              min={-1024}
              max={3000}
              step={10}
              value={hi}
              onChange={(e) => { setHi(Number(e.target.value)); setPresetKey(''); }}
              onDoubleClick={() => { setLo(HU_PRESETS[lastPreset.current].lo); setPresetKey(lastPreset.current); setHi(HU_PRESETS[lastPreset.current].hi); }}
              title="upper HU bound of the grow · double-click = back to the last preset"
              style={{ width: 90 }}
            />
          </label>
          <span
            style={small}
            title="the grow's vertical bounds — set them with the two handles right of the planes; the dashed green lines on sagittal/coronal show where they sit"
          >
            vertical range {Math.round(zFrac[0] * 100)}–{Math.round(zFrac[1] * 100)}%
          </span>
        </div>
      </div>

      {/* draggable divider: scout ↔ planes */}
      <DragDivider
        cursor="col-resize"
        title="drag to resize the scout vs the planes · double-click resets"
        style={{ borderRadius: 3, alignSelf: 'stretch' }}
        onMove={(clientX) => {
          const r = rootRef.current?.getBoundingClientRect();
          if (!r || !r.width) return;
          setLeftFrac(Math.min(0.6, Math.max(0.24, (clientX - r.left) / r.width)));
        }}
        onReset={() => setLeftFrac(0.42)}
      />

      {/* right: sag + coronal (draggable split, z-range handles on the shared right edge) + stats */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, minWidth: 0 }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 6 }}>
          <div
            ref={planesRef}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: `minmax(80px, ${(sagFrac * 100).toFixed(2)}%) 6px 1fr`,
              gap: 6,
            }}
          >
            <div style={{ position: 'relative', minWidth: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
              <canvas ref={sagCv} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              <span style={{ position: 'absolute', top: 4, left: 6, ...small, pointerEvents: 'none' }}>SAGITTAL @ seed</span>
              {!seed && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12 }}>set a seed →</div>}
            </div>
            <DragDivider
              cursor="col-resize"
              title="drag to resize sagittal vs coronal · double-click resets"
              style={{ borderRadius: 3 }}
              onMove={(clientX) => {
                const r = planesRef.current?.getBoundingClientRect();
                if (!r || !r.width) return;
                setSagFrac(Math.min(0.8, Math.max(0.2, (clientX - r.left) / r.width)));
              }}
              onReset={() => setSagFrac(0.5)}
            />
            <div style={{ position: 'relative', minWidth: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
              <canvas ref={corCv} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              <span style={{ position: 'absolute', top: 4, left: 6, ...small, pointerEvents: 'none' }}>CORONAL @ seed</span>
            </div>
          </div>
          <VertRangeSliders zFrac={zFrac} setZFrac={setZFrac} verb="bound the grow" noun="the grow window" />
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 210, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {busy && <div style={small}>growing…</div>}
            {hint && <div style={{ ...small, color: 'var(--warn)', whiteSpace: 'normal', lineHeight: 1.4 }}>⚠ {hint}</div>}
            {result ? (
              <>
                {stat('volume', `${result.volumeCm3.toFixed(2)} cm³`)}
                {stat('voxels', result.voxelCount.toLocaleString())}
                {stat('mean HU', `${result.meanHU.toFixed(0)} ± ${result.sdHU.toFixed(0)}`)}
                {stat('range HU', `${result.minHU.toFixed(0)} … ${result.maxHU.toFixed(0)}`)}
                {stat('narrowest', `${result.narrowestAreaMm2.toFixed(1)} mm²`)}
                {result.capped && <div style={{ ...small, color: 'var(--warn)' }}>⚠ hit the 4M-voxel cap — tighten the box or range</div>}
              </>
            ) : (
              <div style={{ ...small, whiteSpace: 'normal', lineHeight: 1.5 }}>
                Pick a density preset, draw a box around the target, then click a seed inside it.
                Corners resize the box, its inside drags it, right-click deletes it; the two
                handles right of the planes bound the grow vertically (dashed lines show them).
                For an airway: air preset, a box around the pharynx, seed in the black column — the
                graph below is its area at each height, narrowest slice flagged.
              </div>
            )}
          </div>
          <div>
            <div style={small}>cross-sectional area vs height</div>
            <canvas ref={areaCv} style={{ width: 220, height: 90, borderRadius: 4, border: '1px solid var(--border)' }} />
          </div>
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
