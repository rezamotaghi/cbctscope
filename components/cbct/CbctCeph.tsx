'use client';
// Virtual cephalogram: a projective 2D radiograph rendered
// straight out of the CBCT volume — the whole depth integrated along one viewing direction,
// exactly like an X-ray film. AVG = film-like (every structure along the ray summed); MIP =
// only the densest structure per ray (a bone-forward look). Standard directions (lateral /
// PA / AP) as one-click presets, plus free rotation (drag = turn the head) and sagittal tilt,
// window + gamma, and save-to-PNG. The heavy full-depth integral renders at a coarse stride
// while you drag and refines to full resolution when you let go. Reuses oblique.ts.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadVolumeData, type CbctMeta, type VolumeEntry } from './volumeData';
import { renderOblique, projectHU, rotV, type Basis, type V3 } from './oblique';

interface Props {
  anon: string;
  voi: { center: number; width: number } | null;
  invert: boolean;
  onMeta?: (meta: CbctMeta) => void;
  onError?: (msg: string) => void;
}

// LPS voxels: +x = patient LEFT, +y = POSTERIOR, +z = SUPERIOR.
// v points DOWN the image rows, n is the viewing (projection) axis.
type PresetKey = 'lateralL' | 'lateralR' | 'pa' | 'ap';
const PRESETS: Record<PresetKey, { label: string; basis: Basis; tip: string }> = {
  // looking from the patient's LEFT: anterior at viewer-left → column+ = posterior (u=+y)
  lateralL: { label: 'Lateral L', basis: { u: [0, 1, 0], v: [0, 0, -1], n: [-1, 0, 0] }, tip: 'profile, looking from the left' },
  lateralR: { label: 'Lateral R', basis: { u: [0, -1, 0], v: [0, 0, -1], n: [1, 0, 0] }, tip: 'profile, looking from the right' },
  // PA (looking anterior→posterior along +y): patient right at viewer-left (film convention)
  pa: { label: 'PA', basis: { u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] }, tip: 'front, postero-anterior' },
  ap: { label: 'AP', basis: { u: [-1, 0, 0], v: [0, 0, -1], n: [0, -1, 0] }, tip: 'front, antero-posterior' },
};

const PREVIEW_STRIDE = 3; // coarse pass while dragging
const DEG_PER_PX = 0.4;

/** Robust display window from projected HU percentiles. */
function autoWindowHU(data: Float32Array): { center: number; width: number } {
  const sample: number[] = [];
  for (let i = 0; i < data.length; i += 7) {
    const v = data[i];
    if (v > -950) sample.push(v);
  }
  if (sample.length < 64) return { center: 300, width: 2500 };
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.02)];
  const hi = sample[Math.floor(sample.length * 0.99)];
  const width = Math.max(hi - lo, 200);
  return { center: Math.round(lo + width / 2), width: Math.round(width) };
}

export default function CbctCeph({ anon, voi, invert, onMeta, onError }: Props) {
  const [entry, setEntry] = useState<VolumeEntry | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [preset, setPreset] = useState<PresetKey>('lateralL');
  const [yaw, setYaw] = useState(0); // turn about the superior axis
  const [tilt, setTilt] = useState(0); // rotation about the horizontal (L-R) axis
  const [mip, setMip] = useState(false);
  const [cephVoi, setCephVoi] = useState<{ center: number; width: number } | null>(null);
  const [gamma, setGamma] = useState(1);
  const [dragging, setDragging] = useState(false);

  const cv = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stale = false;
    setEntry(null);
    setProgress(0);
    setCephVoi(null);
    setYaw(0);
    setTilt(0);
    loadVolumeData(anon, (f) => !stale && setProgress(Math.min(0.95, f)))
      .then((e) => {
        if (stale) return;
        setEntry(e);
        onMeta?.(e.meta);
        setProgress(null);
      })
      .catch((err) => {
        console.error('[cbct-ceph] load failed', err);
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

  const effVoi = cephVoi ?? voi ?? entry?.meta.defaultVoi ?? { center: 300, width: 2500 };

  // basis = preset, yawed about superior (world z), then tilted about its own horizontal axis u
  const basis = useMemo<Basis>(() => {
    const base = PRESETS[preset].basis;
    const zAxis: V3 = [0, 0, 1];
    let u = rotV(base.u, zAxis, yaw);
    let v = rotV(base.v, zAxis, yaw);
    let n = rotV(base.n, zAxis, yaw);
    // tilt about the (yawed) horizontal image axis u
    v = rotV(v, u, tilt);
    n = rotV(n, u, tilt);
    u = rotV(u, u, tilt); // (no-op, keeps types uniform)
    return { u, v, n };
  }, [preset, yaw, tilt]);

  const render = useCallback(
    (stride: number) => {
      const canvas = cv.current;
      if (!canvas || !entry) return;
      const lower = effVoi.center - effVoi.width / 2;
      const upper = effVoi.center + effVoi.width / 2;
      // full-depth integral: renderOblique with a slab spanning the whole volume along n
      const depth = Math.round(
        Math.abs(basis.n[0]) * entry.meta.dims[0] +
          Math.abs(basis.n[1]) * entry.meta.dims[1] +
          Math.abs(basis.n[2]) * entry.meta.dims[2],
      );
      const img = renderOblique(entry, basis, 0, depth, mip, lower, upper, invert, gamma, stride);
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext('2d')?.putImageData(img, 0, 0);
    },
    [entry, basis, effVoi.center, effVoi.width, mip, invert, gamma],
  );

  // coarse while interacting, full-res shortly after settling
  useEffect(() => {
    if (!entry) return;
    render(dragging ? PREVIEW_STRIDE : 1);
    if (!dragging) return;
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(() => render(1), 180);
    return () => {
      if (settleRef.current) clearTimeout(settleRef.current);
    };
  }, [entry, render, dragging]);

  // drag to rotate: horizontal = yaw, vertical = tilt
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    setYaw((y) => y + dx * DEG_PER_PX);
    setTilt((t) => Math.max(-60, Math.min(60, t - dy * DEG_PER_PX)));
  };
  const onUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const runAuto = () => {
    if (!entry) return;
    const { data } = projectHU(entry, basis, mip, 2);
    setCephVoi(autoWindowHU(data));
  };

  const savePng = () => {
    const canvas = cv.current;
    if (!canvas) return;
    try {
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height + 20;
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, 0, 0);
      ctx.fillStyle = '#aeb6c6';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${anon} · virtual cephalogram · ${PRESETS[preset].label}${mip ? ' MIP' : ''} · ${new Date().toISOString().slice(0, 10)}`, 6, out.height - 4);
      const a = document.createElement('a');
      a.href = out.toDataURL('image/png');
      a.download = `${anon}_ceph_${preset}.png`;
      a.click();
    } catch {
      onError?.('save failed');
    }
  };

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

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, width: '100%', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
          <button
            key={k}
            style={chip(preset === k)}
            title={PRESETS[k].tip}
            onClick={() => {
              setPreset(k);
              setYaw(0);
              setTilt(0);
            }}
          >
            {PRESETS[k].label}
          </button>
        ))}
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12 }}>
          <input type="checkbox" checked={mip} onChange={(e) => setMip(e.target.checked)} /> MIP (densest-only)
        </label>
        <button style={chip(!!cephVoi)} onClick={runAuto} title="auto contrast from the projection's own densities">
          auto contrast{cephVoi ? ' ✓' : ''}
        </button>
        <button style={chip(false)} onClick={() => { setCephVoi(null); setGamma(1); }} title="back to the volume window">
          reset window
        </button>
        <button style={chip(false)} onClick={savePng} title="save this cephalogram as a PNG">
          💾 save PNG
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: 'var(--viewport-bg)', borderRadius: 4 }}>
        <canvas
          ref={cv}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
        />
        <span style={{ position: 'absolute', top: 8, left: 10, ...small, pointerEvents: 'none' }}>
          {PRESETS[preset].label}
          {yaw ? ` · turn ${yaw > 0 ? '+' : ''}${yaw.toFixed(0)}°` : ''}
          {tilt ? ` · tilt ${tilt > 0 ? '+' : ''}${tilt.toFixed(0)}°` : ''}
          {' · drag = turn/tilt'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
          turn {yaw.toFixed(0)}°
          <input type="range" min={-180} max={180} step={1} value={((yaw % 360) + 540) % 360 - 180} onChange={(e) => setYaw(Number(e.target.value))} onDoubleClick={() => setYaw(0)} style={{ width: 140 }} />
        </label>
        <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
          tilt (sagittal) {tilt.toFixed(0)}°
          <input type="range" min={-60} max={60} step={1} value={tilt} onChange={(e) => setTilt(Number(e.target.value))} onDoubleClick={() => setTilt(0)} style={{ width: 120 }} />
        </label>
        <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
          contrast center {effVoi.center}
          <input type="range" min={-1000} max={3000} step={10} value={effVoi.center} onChange={(e) => setCephVoi({ center: Number(e.target.value), width: effVoi.width })} style={{ width: 130 }} />
        </label>
        <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
          width {effVoi.width}
          <input type="range" min={50} max={4500} step={10} value={effVoi.width} onChange={(e) => setCephVoi({ center: effVoi.center, width: Number(e.target.value) })} style={{ width: 130 }} />
        </label>
        <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
          gamma {gamma.toFixed(2)}
          <input type="range" min={0.3} max={3} step={0.05} value={gamma} onChange={(e) => setGamma(Number(e.target.value))} onDoubleClick={() => setGamma(1)} style={{ width: 110 }} />
        </label>
      </div>
      <div style={{ ...small }}>
        A film-like radiograph reconstructed from the volume: AVG sums every structure along
        the ray (true ceph look), MIP keeps only the densest. Not a substitute for a real ceph
        (no true focal geometry), but measurable and reproducible off the same scan.
      </div>

      {progress !== null && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(12,14,18,0.82)', zIndex: 5, color: 'var(--text-dim)' }}>
          loading volume… {Math.round((progress ?? 0) * 100)}%
        </div>
      )}
    </div>
  );
}
