'use client';
// Region growing + airway. The reader draws a bounding box
// on the axial scout, picks a density preset (air / soft / bone / tooth) or a manual HU range,
// then clicks a seed inside the target: every connected voxel in range floods out (bounded by
// the box) into a mask shown over all three orthogonal planes. The panel reports volume,
// HU stats, and the per-height cross-sectional area profile with the narrowest slice flagged —
// the airway read. Pure canvas off the shared HU cache; the fill runs in regionGrow.ts.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadVolumeData, type CbctMeta, type VolumeEntry } from './volumeData';
import { toImageData } from './curvedReformat';
import { growRegion, HU_PRESETS, type GrowResult, type GrowBox } from './regionGrow';

interface Props {
  anon: string;
  voi: { center: number; width: number } | null;
  invert: boolean;
  onMeta?: (meta: CbctMeta) => void;
  onError?: (msg: string) => void;
}

const MASK_RGB: [number, number, number] = [76, 220, 140]; // green mask
const BOX_COLOR = 'rgba(120,200,255,0.9)';
const SEED_COLOR = 'rgba(255,95,95,0.95)';

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

export default function CbctRegion({ anon, voi, invert, onMeta, onError }: Props) {
  const [entry, setEntry] = useState<VolumeEntry | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [axialZ, setAxialZ] = useState(0);
  const [presetKey, setPresetKey] = useState<string>('air');
  const [lo, setLo] = useState(-1024);
  const [hi, setHi] = useState(-400);
  const [smooth, setSmooth] = useState(false);
  const [zDepth, setZDepth] = useState(80); // ± slices around the seed the box spans
  const [box2d, setBox2d] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null); // voxel x,y rect
  const [seed, setSeed] = useState<[number, number, number] | null>(null);
  const [result, setResult] = useState<GrowResult | null>(null);
  const [busy, setBusy] = useState(false);

  const axialCv = useRef<HTMLCanvasElement | null>(null);
  const sagCv = useRef<HTMLCanvasElement | null>(null);
  const corCv = useRef<HTMLCanvasElement | null>(null);
  const areaCv = useRef<HTMLCanvasElement | null>(null);
  const boxDraft = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const drawingBox = useRef(false);

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

  const applyPreset = (key: string) => {
    setPresetKey(key);
    const p = HU_PRESETS[key];
    if (p) {
      setLo(p.lo);
      setHi(p.hi);
    }
  };

  // the 3D box: drawn x,y rect (or whole slice) × z-depth around the seed's z (or axialZ)
  const growBox = useCallback(
    (seedZ: number): GrowBox => {
      const r = box2d ?? { x0: 0, y0: 0, x1: nx - 1, y1: ny - 1 };
      return {
        x0: Math.min(r.x0, r.x1),
        x1: Math.max(r.x0, r.x1),
        y0: Math.min(r.y0, r.y1),
        y1: Math.max(r.y0, r.y1),
        z0: seedZ - zDepth,
        z1: seedZ + zDepth,
      };
    },
    [box2d, nx, ny, zDepth],
  );

  // recompute the grow whenever the inputs change (seed set)
  useEffect(() => {
    if (!entry || !seed) {
      setResult(null);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      try {
        const res = growRegion(entry, seed, Math.min(lo, hi), Math.max(lo, hi), growBox(seed[2]), smooth);
        setResult(res);
        if (!res) onError?.('the seed voxel is outside the HU range — click on the target tissue, or widen the range');
      } catch (err) {
        console.error('[cbct-region] grow failed', err);
        onError?.('region grow failed — see console');
      } finally {
        setBusy(false);
      }
    }, 60);
    return () => clearTimeout(t);
  }, [entry, seed, lo, hi, smooth, growBox, onError]);

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
      const id = toImageData({ data, width: w, height: h }, effVoi, invert);
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
    [entry, nx, ny, nz, effVoi, invert, result],
  );

  // axial: slice + box + seed marker + mask
  useEffect(() => {
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
    if (seed && seed[2] === axialZ) {
      ctx.fillStyle = SEED_COLOR;
      ctx.beginPath();
      ctx.arc(seed[0], seed[1], 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [entry, axialZ, box2d, seed, renderPlane]);

  // sag/coronal through the seed
  useEffect(() => {
    if (!entry || !seed) return;
    renderPlane('sagittal', seed[0], sagCv.current);
    renderPlane('coronal', seed[1], corCv.current);
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
  }, [entry, seed, result, renderPlane, nz]);

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
  const onAxialDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const v = axialVox(e);
    if (!v) return;
    (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
    drawingBox.current = true;
    boxDraft.current = { x0: v[0], y0: v[1], x1: v[0], y1: v[1] };
  };
  const onAxialMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingBox.current || !boxDraft.current) return;
    const v = axialVox(e);
    if (!v) return;
    boxDraft.current = { ...boxDraft.current, x1: v[0], y1: v[1] };
    // nudge a redraw
    setResult((r) => r);
    const cv = axialCv.current;
    if (cv && entry) {
      const ctx = cv.getContext('2d');
      if (ctx) {
        renderPlane('axial', axialZ, cv);
        const r = boxDraft.current;
        ctx.strokeStyle = BOX_COLOR;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
      }
    }
  };
  const onAxialUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingBox.current) return;
    drawingBox.current = false;
    const r = boxDraft.current;
    boxDraft.current = null;
    if (!r) return;
    const area = Math.abs(r.x1 - r.x0) * Math.abs(r.y1 - r.y0);
    if (area > 25) {
      setBox2d(r); // a real drag = set the bounding box
    } else {
      // a click = drop the seed here (in the current box, or whole slice) and grow
      const v = axialVox(e);
      if (v) setSeed([v[0], v[1], axialZ]);
    }
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
    <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(320px, 42%) 1fr', gap: 8, width: '100%', height: '100%', minHeight: 0 }}>
      {/* left: axial (box + seed) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
          <canvas
            ref={axialCv}
            onPointerDown={onAxialDown}
            onPointerMove={onAxialMove}
            onPointerUp={onAxialUp}
            style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'crosshair', touchAction: 'none', display: 'block' }}
          />
          <span style={{ position: 'absolute', top: 6, left: 8, ...small, pointerEvents: 'none' }}>
            AXIAL {entry ? `${axialZ + 1}/${nz}` : ''} · drag = bounding box · click = seed · wheel = slice
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '2px' }}>
          {Object.keys(HU_PRESETS).map((k) => (
            <button key={k} style={chip(presetKey === k)} title={`${HU_PRESETS[k].lo}…${HU_PRESETS[k].hi} HU`} onClick={() => applyPreset(k)}>
              {HU_PRESETS[k].label}
            </button>
          ))}
          <label style={{ ...small, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} /> smooth
          </label>
          <button style={chip(false)} disabled={!box2d && !seed} onClick={() => { setBox2d(null); setSeed(null); setResult(null); }}>
            clear
          </button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '2px', alignItems: 'center' }}>
          <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
            HU {lo}
            <input type="range" min={-1024} max={3000} step={10} value={lo} onChange={(e) => { setLo(Number(e.target.value)); setPresetKey(''); }} style={{ width: 90 }} />
          </label>
          <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
            – {hi}
            <input type="range" min={-1024} max={3000} step={10} value={hi} onChange={(e) => { setHi(Number(e.target.value)); setPresetKey(''); }} style={{ width: 90 }} />
          </label>
          <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }} title="how many slices above and below the seed the grow may reach">
            depth ±{zDepth}
            <input type="range" min={5} max={200} step={5} value={zDepth} onChange={(e) => setZDepth(Number(e.target.value))} style={{ width: 90 }} />
          </label>
        </div>
      </div>

      {/* right: sag + coronal + stats */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0, minWidth: 0 }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 6 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
            <canvas ref={sagCv} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            <span style={{ position: 'absolute', top: 4, left: 6, ...small, pointerEvents: 'none' }}>SAGITTAL @ seed</span>
            {!seed && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 12 }}>set a seed →</div>}
          </div>
          <div style={{ position: 'relative', flex: 1, minWidth: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
            <canvas ref={corCv} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            <span style={{ position: 'absolute', top: 4, left: 6, ...small, pointerEvents: 'none' }}>CORONAL @ seed</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 210, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {busy && <div style={small}>growing…</div>}
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
