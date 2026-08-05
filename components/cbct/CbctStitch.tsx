'use client';
// Volume stitching : register two same-patient CBCT volumes
// and fuse them into one larger volume that then reads in every /cbct view. Volume A is the
// current volume; pick B from the catalog. Nudge B with translate/rotate sliders, or let
// auto-registration find the rigid transform (NCC hill-climb; "+ tilt" also searches rotation).
// The tri-plane preview overlays A (green) and B (magenta) so misalignment shows as colour
// fringes — perfect overlap reads neutral. "Bake & load" resamples both onto one grid, POSTs it
// to the server (a `fused_` id held in memory), and switches the viewer to it. Math: stitch.ts.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadVolumeData, type CbctMeta, type VolumeEntry } from './volumeData';
import { snapshotPaneCanvases, type SnapRef } from './SnapshotButton';
import { Merge } from 'lucide-react';
import {
  autoRegister,
  bakeFusion,
  nccScore,
  volCenterWorld,
  aWorldToB,
  sampleWorld,
  worldOfVoxel,
  IDENTITY,
  type Rigid,
} from './stitch';

interface ListEntry {
  anon: string;
  dims: [number, number, number];
  fov: [number, number];
  region: string;
  year: string;
  label?: string;
}

interface Props {
  anon: string; // volume A
  voi: { center: number; width: number } | null;
  invert: boolean;
  gamma: number;
  volumes: ListEntry[];
  onFused: (anon: string) => void;
  onMeta?: (meta: CbctMeta) => void;
  onError?: (msg: string) => void;
  /** the shell's one snapshot button calls the registered composer */
  snapRef?: SnapRef;
}

type Mode = 'color' | 'blend' | 'checker' | 'A' | 'B';
type Plane = 'axial' | 'sagittal' | 'coronal';

const isFused = (id: string) => id.startsWith('fused_');

export default function CbctStitch({ anon, voi, invert, gamma, volumes, onFused, onMeta, onError, snapRef }: Props) {
  const [entryA, setEntryA] = useState<VolumeEntry | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const [entryB, setEntryB] = useState<VolumeEntry | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [rigid, setRigid] = useState<Rigid>(IDENTITY);
  const [mode, setMode] = useState<Mode>('color');
  const [score, setScore] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // recoverable failures (B load, auto-register, bake) surface HERE inline — never through
  // onError, which replaces the whole pane and the hand-tuned transform with it
  const [hint, setHint] = useState<string | null>(null);

  // per-preview slice offset from the volume center : the three fixed center
  // slices could hide misalignment at the condyles until AFTER bake — wheel to verify
  // anywhere along each axis
  const [sliceOff, setSliceOff] = useState<Record<Plane, number>>({ axial: 0, sagittal: 0, coronal: 0 });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const axCv = useRef<HTMLCanvasElement | null>(null);
  const sgCv = useRef<HTMLCanvasElement | null>(null);
  const coCv = useRef<HTMLCanvasElement | null>(null);

  const candidates = useMemo(
    () => volumes.filter((v) => v.anon !== anon && !isFused(v.anon)),
    [volumes, anon],
  );

  // load A
  useEffect(() => {
    let stale = false;
    setEntryA(null);
    setProgress(0);
    setRigid(IDENTITY);
    setScore(null);
    setSliceOff({ axial: 0, sagittal: 0, coronal: 0 });
    loadVolumeData(anon, (f) => !stale && setProgress(Math.min(0.9, f)))
      .then((e) => {
        if (stale) return;
        setEntryA(e);
        onMeta?.(e.meta);
        setProgress(null);
      })
      .catch(() => {
        if (!stale) {
          setProgress(null);
          onError?.('volume A load failed');
        }
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anon]);

  // load B
  useEffect(() => {
    if (!bId) {
      setEntryB(null);
      return;
    }
    let stale = false;
    setEntryB(null);
    setRigid(IDENTITY);
    setScore(null);
    setHint(null);
    loadVolumeData(bId)
      .then((e) => {
        if (!stale) setEntryB(e);
      })
      .catch((e) => {
        console.error('[cbct-stitch] volume B load failed', e);
        if (!stale) setHint('volume B load failed — pick a different volume and try again');
      });
    return () => {
      stale = true;
    };
  }, [bId]);

  const effVoi = useMemo(() => voi ?? entryA?.meta.defaultVoi ?? { center: 300, width: 2500 }, [voi, entryA]);
  const cB = useMemo(() => (entryB ? volCenterWorld(entryB.meta) : null), [entryB]);

  const win = useCallback(
    (v: number | null): number => {
      if (v === null) return -1;
      const lo = effVoi.center - effVoi.width / 2;
      let t = (v - lo) / Math.max(1, effVoi.width);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (gamma !== 1) t = Math.pow(t, 1 / Math.max(0.05, gamma));
      if (invert) t = 1 - t;
      return t * 255;
    },
    [effVoi, invert, gamma],
  );

  // ---- render one fused preview plane at A's center
  const renderPlane = useCallback(
    (plane: Plane, cv: HTMLCanvasElement | null) => {
      if (!cv || !entryA) return;
      const A = entryA;
      const [nx, ny, nz] = A.meta.dims;
      const clampi = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
      const cx = clampi(Math.floor(nx / 2) + sliceOff.sagittal, nx);
      const cy = clampi(Math.floor(ny / 2) + sliceOff.coronal, ny);
      const cz = clampi(Math.floor(nz / 2) + sliceOff.axial, nz);
      let w: number, h: number;
      if (plane === 'axial') { w = nx; h = ny; }
      else if (plane === 'sagittal') { w = ny; h = nz; }
      else { w = nx; h = nz; }
      const id = new ImageData(w, h);
      const px = id.data;
      for (let r = 0; r < h; r++)
        for (let c = 0; c < w; c++) {
          let i: number, j: number, k: number;
          if (plane === 'axial') { i = c; j = r; k = cz; }
          else if (plane === 'sagittal') { i = cx; j = c; k = nz - 1 - r; }
          else { i = c; j = cy; k = nz - 1 - r; }
          const aVal = i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz
            ? A.scalar[k * ny * nx + j * nx + i]
            : null;
          const wpt = worldOfVoxel(A.meta, i, j, k);
          let bVal: number | null = null;
          if (entryB && cB) {
            const bw = aWorldToB(wpt, cB, rigid);
            bVal = sampleWorld(entryB, bw[0], bw[1], bw[2]);
          }
          const ga = win(aVal);
          const gb = win(bVal);
          const o = (r * w + c) * 4;
          let R: number, G: number, Bl: number;
          if (mode === 'A' || !entryB) { R = G = Bl = Math.max(0, ga); }
          else if (mode === 'B') { R = G = Bl = Math.max(0, gb); }
          else if (mode === 'blend') {
            const a = Math.max(0, ga), b = Math.max(0, gb);
            const g = ga >= 0 && gb >= 0 ? (a + b) / 2 : Math.max(a, b);
            R = G = Bl = g;
          } else if (mode === 'checker') {
            const useA = (Math.floor(c / 24) + Math.floor(r / 24)) % 2 === 0;
            const g = useA ? Math.max(0, ga) : Math.max(0, gb);
            R = G = Bl = g;
          } else {
            // color: A → green, B → magenta; overlap → grey/white, misalign → colour fringes
            const a = Math.max(0, ga), b = Math.max(0, gb);
            R = b; G = a; Bl = b;
          }
          px[o] = R; px[o + 1] = G; px[o + 2] = Bl; px[o + 3] = 255;
        }
      cv.width = w;
      cv.height = h;
      cv.getContext('2d')?.putImageData(id, 0, 0);
    },
    [entryA, entryB, cB, rigid, mode, win, sliceOff],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      renderPlane('axial', axCv.current);
      renderPlane('sagittal', sgCv.current);
      renderPlane('coronal', coCv.current);
    }, 40);
    return () => clearTimeout(t);
  }, [renderPlane]);

  // live NCC readout whenever the transform settles
  useEffect(() => {
    if (!entryA || !entryB) {
      setScore(null);
      return;
    }
    const t = setTimeout(() => {
      try {
        setScore(nccScore(entryA, entryB, rigid));
      } catch {
        setScore(null);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [entryA, entryB, rigid]);

  const runAuto = (withTilt: boolean) => {
    if (!entryA || !entryB) return;
    setBusy(withTilt ? 'registering (+ tilt)…' : 'registering…');
    // let the label paint before the sync hill-climb
    setTimeout(() => {
      try {
        const res = autoRegister(entryA, entryB, withTilt, rigid);
        setRigid(res);
        setHint(null);
      } catch (e) {
        console.error('[cbct-stitch] auto-register failed', e);
        setHint('auto-registration failed — the manual sliders still work');
      } finally {
        setBusy(null);
      }
    }, 30);
  };

  const bakeAndLoad = () => {
    if (!entryA || !entryB) return;
    setBusy('baking fusion…');
    setTimeout(async () => {
      try {
        const baked = bakeFusion(entryA, entryB, rigid);
        const aLabel = volumes.find((v) => v.anon === anon)?.label ?? anon.slice(0, 11);
        const bLabel = volumes.find((v) => v.anon === bId)?.label ?? (bId ?? '').slice(0, 11);
        const meta = {
          dims: baked.dims,
          spacing: baked.spacing,
          origin: baked.origin,
          defaultVoi: baked.defaultVoi,
          label: `stitch ${aLabel}+${bLabel}`,
          year: entryA.meta.year,
        };
        setBusy('uploading fusion…');
        const bytes = new Uint8Array(baked.data.buffer as ArrayBuffer, baked.data.byteOffset, baked.data.byteLength);
        const res = await fetch('/api/cbct/fused', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'x-omfr-fused-meta': JSON.stringify(meta) },
          body: new Blob([bytes]), // raw Int16 LE voxel bytes
        });
        const j = await res.json();
        if (!res.ok || !j.anon) throw new Error(j.error ?? `bake upload failed (${res.status})`);
        onFused(j.anon);
      } catch (e) {
        console.error('[cbct-stitch] bake failed', e);
        setHint(`bake failed: ${String(e)} — the transform is untouched, try again`);
      } finally {
        setBusy(null);
      }
    }, 30);
  };


  // one snapshot door: the shell header owns the button; this room registers its composer
  useEffect(() => {
    if (!snapRef) return;
    snapRef.current = () =>
      void snapshotPaneCanvases(
        rootRef.current,
        `${anon} · stitch · ${new Date().toISOString().slice(0, 10)}`,
        `${anon}_stitch.png`,
      );
  });
  useEffect(() => {
    if (!snapRef) return;
    return () => {
      snapRef.current = null;
    };
  }, [snapRef]);

  const chip = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent-dim)' : 'var(--panel-2)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: 12,
  });
  const small: React.CSSProperties = { fontSize: 11, color: 'var(--text-dim)' };
  const axisSlider = (label: string, kind: 't' | 'r', dim: 0 | 1 | 2, min: number, max: number, step: number, unit: string) => (
    <label style={{ ...small, flex: 1, minWidth: 150, display: 'flex', gap: 6, alignItems: 'center' }}>
      {label} {rigid[kind][dim].toFixed(1)}{unit}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={rigid[kind][dim]}
        disabled={!entryB}
        title={entryB ? `move B ${label} — double-click = 0` : 'pick volume B first'}
        onChange={(e) => {
          const v = Number(e.target.value);
          setRigid((cur) => {
            const next: Rigid = { t: [...cur.t] as [number, number, number], r: [...cur.r] as [number, number, number] };
            next[kind][dim] = v;
            return next;
          });
        }}
        onDoubleClick={() =>
          setRigid((cur) => {
            const next: Rigid = { t: [...cur.t] as [number, number, number], r: [...cur.r] as [number, number, number] };
            next[kind][dim] = 0;
            return next;
          })
        }
        style={{ flex: 1 }}
      />
    </label>
  );

  const pane = (label: string, plane: Plane, ref: React.RefObject<HTMLCanvasElement | null>) => (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
      <canvas ref={ref as React.RefObject<HTMLCanvasElement>} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      <span style={{ position: 'absolute', top: 4, left: 6, ...small, pointerEvents: 'none' }}>
        {label}
        {sliceOff[plane] !== 0 ? ` ${sliceOff[plane] > 0 ? '+' : ''}${sliceOff[plane]}` : ''} · wheel = slice
      </span>
    </div>
  );

  // wheel steps the compared slice on each preview (native non-passive listeners — React's
  // wheel is passive, so preventDefault to keep the page from scrolling)
  useEffect(() => {
    const wire = (cv: HTMLCanvasElement | null, plane: Plane) => {
      if (!cv) return () => {};
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const dir = e.deltaY > 0 ? 1 : -1;
        setSliceOff((cur) => ({ ...cur, [plane]: cur[plane] + dir * 3 }));
      };
      cv.addEventListener('wheel', onWheel, { passive: false });
      return () => cv.removeEventListener('wheel', onWheel);
    };
    const offs = [wire(axCv.current, 'axial'), wire(sgCv.current, 'sagittal'), wire(coCv.current, 'coronal')];
    return () => offs.forEach((f) => f());
  }, [entryA]);

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, width: '100%', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={small}>fuse the current volume (A, green) with</span>
        <select
          value={bId ?? ''}
          onChange={(e) => setBId(e.target.value || null)}
          style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', maxWidth: 320 }}
        >
          <option value="">— pick volume B (magenta) —</option>
          {candidates.map((v) => (
            <option key={v.anon} value={v.anon}>
              {v.label || v.anon.slice(5, 11)} — {v.fov[0]}×{v.fov[1]}cm {v.region || ''}
            </option>
          ))}
        </select>
        <button style={chip(false)} disabled={!entryB || !!busy} onClick={() => runAuto(false)} title="find the best translation (NCC hill-climb)">
          auto align
        </button>
        <button style={chip(false)} disabled={!entryB || !!busy} onClick={() => runAuto(true)} title="also search rotation (slower)">
          auto + tilt
        </button>
        <button style={chip(false)} disabled={!entryB} onClick={() => setRigid(IDENTITY)}>
          reset transform
        </button>
        <button
          style={{ ...chip(false), display: 'inline-flex', alignItems: 'center', gap: 5 }}
          disabled={!entryB || !!busy}
          onClick={bakeAndLoad}
          title="resample both onto one grid, register the fused volume, and open it"
        >
          <Merge size={13} strokeWidth={2} />
          bake &amp; load
        </button>
        {score !== null && (
          <span
            style={{ ...small, color: score > 0.6 ? 'var(--ok, #59d98c)' : 'var(--text-dim)' }}
            title="normalized cross-correlation of the two volumes' densities over the overlap — 1.0 = identical; above ~0.6 reads as aligned (turns green)"
          >
            overlap NCC {score.toFixed(3)}
          </span>
        )}
        {busy && <span style={{ ...small, color: 'var(--accent)' }}>{busy}</span>}
        {hint && <span style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {hint}</span>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={small}>overlay</span>
        {(['color', 'blend', 'checker', 'A', 'B'] as Mode[]).map((m) => (
          <button key={m} style={chip(mode === m)} onClick={() => setMode(m)} title={m === 'color' ? 'A green / B magenta — fringes = misalignment' : m}>
            {m}
          </button>
        ))}
      </div>

      {/* transform sliders ride the toolbar (pane-global, Grid-style — the surface-anchored
          rule Reza ratified 2026-08-05 puts per-surface rows under their surface and
          pane-global params up top) */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {axisSlider('X', 't', 0, -60, 60, 0.5, 'mm')}
        {axisSlider('Y', 't', 1, -60, 60, 0.5, 'mm')}
        {axisSlider('Z', 't', 2, -60, 60, 0.5, 'mm')}
        {axisSlider('rX', 'r', 0, -20, 20, 0.5, '°')}
        {axisSlider('rY', 'r', 1, -20, 20, 0.5, '°')}
        {axisSlider('rZ', 'r', 2, -20, 20, 0.5, '°')}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 6 }}>
        {pane('AXIAL', 'axial', axCv)}
        {pane('SAGITTAL', 'sagittal', sgCv)}
        {pane('CORONAL', 'coronal', coCv)}
        {!entryB && (
          <div style={{ position: 'absolute', inset: 0, top: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: 13, pointerEvents: 'none' }}>
            pick a second volume of the same patient to begin
          </div>
        )}
      </div>

      <div style={small}>
        Rigid registration (translation + rotation) of two same-patient scans into one volume.
        Auto-align maximizes density cross-correlation over the overlap; drag the sliders to
        correct it. Bake resamples both onto a shared grid (averaging the overlap) and opens the
        result in every view. The fused volume lives in server memory for this session.
      </div>

      {progress !== null && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(12,14,18,0.82)', zIndex: 5, color: 'var(--text-dim)' }}>
          loading volume A… {Math.round((progress ?? 0) * 100)}%
        </div>
      )}
    </div>
  );
}
