'use client';
// Virtual cephalogram: a projective 2D radiograph rendered
// straight out of the CBCT volume — the whole depth integrated along one viewing direction,
// exactly like an X-ray film. AVG = film-like (every structure along the ray summed); MIP =
// only the densest structure per ray (a bone-forward look). Standard directions (lateral /
// PA / AP) as one-click presets, plus free rotation (drag = turn the head) and nod (tilt),
// window + gamma, and save-to-PNG. The heavy full-depth integral renders at a coarse stride
// while you drag and refines to full resolution when you let go. Reuses oblique.ts.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadVolumeData, type CbctMeta, type VolumeEntry } from './volumeData';
import { renderOblique, projectHU, rotV, type Basis, type V3 } from './oblique';
import { type SnapRef } from './SnapshotButton';

interface Props {
  anon: string;
  voi: { center: number; width: number } | null;
  invert: boolean;
  gamma: number;
  onMeta?: (meta: CbctMeta) => void;
  onError?: (msg: string) => void;
  /** auto-contrast / reset write the SHARED window (the sidebar Window section) — Ceph no
   *  longer keeps a private center/width/gamma that silently diverged from the sliders. */
  onVoi?: (voi: { center: number; width: number } | null) => void;
  /** the shell's one snapshot button calls the registered composer */
  snapRef?: SnapRef;
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

export default function CbctCeph({ anon, voi, invert, gamma, onMeta, onError, onVoi, snapRef }: Props) {
  const [entry, setEntry] = useState<VolumeEntry | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [preset, setPreset] = useState<PresetKey>('lateralL');
  const [yaw, setYaw] = useState(0); // turn about the superior axis
  const [nod, setNod] = useState(0); // tilt about the horizontal (L-R) axis
  const [mip, setMip] = useState(false);
  // the last auto-contrast result — the ✓ shows only while the shared window still equals
  // it
  const lastAutoRef = useRef<{ center: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // recoverable failures (a PNG save throwing) surface HERE inline — never through onError,
  // which replaces the whole pane and destroys the rotated, windowed read in progress
  const [hint, setHint] = useState<string | null>(null);

  const cv = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stale = false;
    setEntry(null);
    setProgress(0);
    setYaw(0);
    setNod(0);
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

  const effVoi = voi ?? entry?.meta.defaultVoi ?? { center: 300, width: 2500 };
  const autoActive =
    !!voi && !!lastAutoRef.current && voi.center === lastAutoRef.current.center && voi.width === lastAutoRef.current.width;

  // basis = preset, yawed about superior (world z), then nodded about its own horizontal axis u
  const basis = useMemo<Basis>(() => {
    const base = PRESETS[preset].basis;
    const zAxis: V3 = [0, 0, 1];
    let u = rotV(base.u, zAxis, yaw);
    let v = rotV(base.v, zAxis, yaw);
    let n = rotV(base.n, zAxis, yaw);
    // nod about the (yawed) horizontal image axis u
    v = rotV(v, u, nod);
    n = rotV(n, u, nod);
    u = rotV(u, u, nod); // (no-op, keeps types uniform)
    return { u, v, n };
  }, [preset, yaw, nod]);

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

  // drag to rotate: horizontal = yaw, vertical = nod
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
    setNod((n) => Math.max(-60, Math.min(60, n - dy * DEG_PER_PX)));
  };
  const onUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const runAuto = () => {
    if (!entry) return;
    const { data } = projectHU(entry, basis, mip, 2);
    const w = autoWindowHU(data);
    lastAutoRef.current = w;
    onVoi?.(w); // writes the SHARED window — the sidebar sliders/histogram follow
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
      setHint(null);
    } catch (e) {
      console.error('[cbct-ceph] save failed', e);
      setHint('PNG save failed — the view is untouched, try again');
    }
  };


  // one snapshot door: the shell header owns the button; this room registers its composer
  useEffect(() => {
    if (!snapRef) return;
    snapRef.current = savePng;
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
              setNod(0);
            }}
          >
            {PRESETS[k].label}
          </button>
        ))}
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12 }}>
          <input type="checkbox" checked={mip} onChange={(e) => setMip(e.target.checked)} /> MIP (densest-only)
        </label>
        <button style={chip(autoActive)} onClick={runAuto} title="pick a window from the projection's own densities — writes the shared Window section (✓ while that window is still active)">
          auto contrast{autoActive ? ' ✓' : ''}
        </button>
        <button style={chip(false)} onClick={() => onVoi?.(null)} title="back to the volume's Auto window (gamma is the sidebar slider)">
          reset window
        </button>
        {hint && <span style={{ fontSize: 11, color: 'var(--warn)' }}>⚠ {hint}</span>}
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
          {/* normalized like the slider readout — continuous dragging accumulates raw yaw,
              and "turn +540°" is not a real head position */}
          {yaw ? ` · turn ${(((yaw % 360) + 540) % 360 - 180) > 0 ? '+' : ''}${(((yaw % 360) + 540) % 360 - 180).toFixed(0)}°` : ''}
          {nod ? ` · nod ${nod > 0 ? '+' : ''}${nod.toFixed(0)}°` : ''}
          {' · drag = turn/tilt'}
        </span>
      </div>

      {/* window/gamma live ONLY in the sidebar Window section now — Ceph carried a private
          center/width/gamma that showed different numbers than the sidebar for the same
          image (the deepest instance of the two-sliders-one-value bug) */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
          turn {(((yaw % 360) + 540) % 360 - 180).toFixed(0)}°
          <input type="range" min={-180} max={180} step={1} value={((yaw % 360) + 540) % 360 - 180} onChange={(e) => setYaw(Number(e.target.value))} onDoubleClick={() => setYaw(0)} style={{ width: 140 }} />
        </label>
        <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }}>
          nod {nod.toFixed(0)}°
          <input type="range" min={-60} max={60} step={1} value={nod} onChange={(e) => setNod(Number(e.target.value))} onDoubleClick={() => setNod(0)} style={{ width: 120 }} />
        </label>
        <span style={small}>window + gamma: the Window (HU) section in the sidebar</span>
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
