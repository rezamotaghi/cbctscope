'use client';
// Single 2D radiograph viewport (kind 'xray': panoramic, DX/CR, intraoral). The server has
// already normalized the frame to Int16 on the 0..4095 gray scale, MONOCHROME2 semantics,
// so window/gamma/invert behave exactly like the volume views. Pure-CPU draw off the shared
// buffer — no Cornerstone in this path, sibling of CbctPano/CbctGrid.
//
// Interaction: wheel zooms about the cursor · left-drag pans · double-click refits.
// resetNonce/fullResetNonce (R / "Reset all") also refit.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { loadVolumeData, type CbctMeta, type VolumeEntry } from './volumeData';
import { computeHistogram, type HistogramData } from './CbctViewport';
import { type SnapRef } from './SnapshotButton';

interface Props {
  anon: string;
  voi: { center: number; width: number } | null;
  invert: boolean;
  gamma: number;
  resetNonce: number;
  fullResetNonce: number;
  onMeta?: (meta: CbctMeta) => void;
  onHistogram?: (h: HistogramData) => void;
  onError?: (msg: string) => void;
  snapRef?: SnapRef;
}

const ZOOM_STEP = 1.15;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;

export default function CbctRadiograph({
  anon,
  voi,
  invert,
  gamma,
  resetNonce,
  fullResetNonce,
  onMeta,
  onHistogram,
  onError,
  snapRef,
}: Props) {
  const [entry, setEntry] = useState<VolumeEntry | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  // a failed PNG save is recoverable: say so inline, never through onError (which would
  // replace the whole pane and throw away the windowed read in progress)
  const [hint, setHint] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // view = css transform: canvas at native pixels, scaled + translated inside the wrapper
  const viewRef = useRef({ zoom: 1, x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; x0: number; y0: number } | null>(null);

  useEffect(() => {
    let stale = false;
    setEntry(null);
    setProgress(0);
    loadVolumeData(anon, (f) => !stale && setProgress(f))
      .then((e) => {
        if (stale) return;
        setEntry(e);
        setProgress(null);
        onMeta?.(e.meta);
        onHistogram?.(computeHistogram(e.scalar));
      })
      .catch((err) => !stale && onError?.(String(err)));
    return () => {
      stale = true;
    };
    // onMeta/onHistogram/onError are stable callbacks from the shell
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anon]);

  const applyView = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const { zoom, x, y } = viewRef.current;
    cv.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
  }, []);

  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    if (!wrap || !cv || !entry) return;
    const [cols, rows] = entry.meta.dims;
    const zoom = Math.min(wrap.clientWidth / cols, wrap.clientHeight / rows) * 0.98;
    viewRef.current = {
      zoom,
      x: (wrap.clientWidth - cols * zoom) / 2,
      y: (wrap.clientHeight - rows * zoom) / 2,
    };
    applyView();
  }, [entry, applyView]);

  // ---- draw the windowed frame (native resolution; zoom is CSS-side)
  useEffect(() => {
    if (!entry) return;
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const [cols, rows] = entry.meta.dims;
    const center = voi?.center ?? entry.meta.defaultVoi.center;
    const width = Math.max(1, voi?.width ?? entry.meta.defaultVoi.width);
    const lower = center - width / 2;
    const range = Math.max(1, width);
    const invGamma = 1 / Math.max(0.05, gamma);
    const raf = requestAnimationFrame(() => {
      cv.width = cols;
      cv.height = rows;
      const img = ctx.createImageData(cols, rows);
      const px = img.data;
      const s = entry.scalar;
      for (let i = 0; i < s.length; i++) {
        let t = (s[i] - lower) / range;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        if (gamma !== 1) t = Math.pow(t, invGamma);
        let g = Math.round(t * 255);
        if (invert) g = 255 - g;
        const o = i * 4;
        px[o] = px[o + 1] = px[o + 2] = g;
        px[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      applyView();
    });
    return () => cancelAnimationFrame(raf);
  }, [entry, voi, invert, gamma, applyView]);

  // fit on load, on reset, and when the pane resizes
  useEffect(() => {
    fit();
  }, [fit, resetNonce, fullResetNonce]);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit]);

  // ---- wheel zoom about the cursor (native listener: React's is passive)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const rect = wrap.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // keep the image point under the cursor fixed while the scale changes
      const k = next / v.zoom;
      viewRef.current = { zoom: next, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
      applyView();
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, [applyView]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const v = viewRef.current;
    dragRef.current = { startX: e.clientX, startY: e.clientY, x0: v.x, y0: v.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    viewRef.current = {
      ...viewRef.current,
      x: d.x0 + (e.clientX - d.startX),
      y: d.y0 + (e.clientY - d.startY),
    };
    applyView();
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  // The radiograph is one image, so its snapshot is the whole frame at native resolution
  // with the displayed window/gamma/invert baked in — zoom and pan are a reading aid, not a
  // crop, and downsampling a pano to whatever fits the pane would throw away the detail the
  // save exists for.
  const savePng = () => {
    const canvas = canvasRef.current;
    if (!canvas || !entry) return;
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
      ctx.fillText(`${anon} · radiograph · ${new Date().toISOString().slice(0, 10)}`, 6, out.height - 4);
      const a = document.createElement('a');
      a.href = out.toDataURL('image/png');
      a.download = `${anon}_radiograph.png`;
      a.click();
      setHint(null);
    } catch (e) {
      console.error('[cbct-radiograph] save failed', e);
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

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={fit}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#000',
        borderRadius: 8,
        cursor: dragRef.current ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
    >
      {entry ? (
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', imageRendering: 'auto' }}
        />
      ) : (
        <div style={{ color: 'var(--text-dim)', padding: 24 }}>
          loading radiograph… {progress !== null ? `${Math.round(progress * 100)}%` : ''}
        </div>
      )}
      {hint && (
        <div
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8,
            padding: '4px 8px',
            borderRadius: 5,
            background: 'rgba(27,31,39,0.92)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            fontSize: 11,
          }}
        >
          ⚠ {hint}
        </div>
      )}
    </div>
  );
}
