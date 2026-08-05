'use client';
// Adjust-levels histogram: the volume's HU distribution with draggable lines.
// Two modes:
//  - window mode (lower/upper/onChange): two cut lines — below the black line renders black,
//    above the white line renders white. Dragging them IS the windowing (VOI lower/upper).
//  - threshold mode (threshold/onThreshold): ONE line — the 3D render's opacity threshold; everything
//    left of it is transparent in the render (the render's histogram threshold).
import React, { useEffect, useRef, useState } from 'react';

export interface HistogramData {
  bins: number[]; // counts per bin
  minHu: number;
  maxHu: number;
}

interface Props {
  data: HistogramData | null;
  lower?: number;
  upper?: number;
  onChange?: (lower: number, upper: number) => void;
  threshold?: number;
  onThreshold?: (hu: number) => void;
  /** value-scale label in the captions; 'HU' for volumes (default), 'gray' for radiographs */
  unit?: string;
  /** double-click reset targets (the universal slider grammar): the nearest line returns
      to its default — window mode falls back to the volume extremes when omitted. */
  defaults?: { lower?: number; upper?: number; threshold?: number };
}

const W = 208;
const H = 64;

export default function CbctHistogram({ data, lower, upper, onChange, threshold, onThreshold, unit = 'HU', defaults }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drag, setDrag] = useState<'lower' | 'upper' | 'threshold' | null>(null);
  const thresholdMode = threshold !== undefined;

  const huToX = (hu: number) =>
    data ? ((hu - data.minHu) / Math.max(1, data.maxHu - data.minHu)) * W : 0;
  const xToHu = (x: number) =>
    data ? data.minHu + (Math.max(0, Math.min(W, x)) / W) * (data.maxHu - data.minHu) : 0;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, 0, W, H);
    if (!data) return;
    // log-scaled bars — air/background dwarfs everything on a linear scale
    const logMax = Math.log10(1 + Math.max(...data.bins));
    ctx.fillStyle = '#8fa3c0';
    const bw = W / data.bins.length;
    data.bins.forEach((count, i) => {
      const h = (Math.log10(1 + count) / logMax) * (H - 4);
      ctx.fillRect(i * bw, H - h, Math.max(1, bw - 0.5), h);
    });
    const handle = (x: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(130,170,255,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 3, H / 2 - 7, 6, 14);
    };
    if (thresholdMode) {
      // one threshold line — right of it is what the 3D render keeps
      const xt = huToX(threshold!);
      ctx.fillStyle = 'rgba(255,170,80,0.14)';
      ctx.fillRect(xt, 0, Math.max(0, W - xt), H);
      handle(xt, '#ffab50');
    } else {
      // cut lines: black point + white point
      const xl = huToX(lower!);
      const xu = huToX(upper!);
      ctx.fillStyle = 'rgba(120,180,255,0.15)';
      ctx.fillRect(xl, 0, Math.max(0, xu - xl), H);
      handle(xl, '#111');
      handle(xu, '#fff');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, lower, upper, threshold]);

  const pick = (x: number): 'lower' | 'upper' | 'threshold' => {
    if (thresholdMode) return 'threshold';
    return Math.abs(x - huToX(lower!)) <= Math.abs(x - huToX(upper!)) ? 'lower' : 'upper';
  };

  const onDown = (e: React.PointerEvent) => {
    if (!data) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const which = pick(x);
    setDrag(which);
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    move(which, x);
  };
  const move = (which: 'lower' | 'upper' | 'threshold', x: number) => {
    const hu = Math.round(xToHu(x));
    if (which === 'threshold') onThreshold?.(hu);
    else if (which === 'lower') onChange?.(Math.min(hu, upper! - 10), upper!);
    else onChange?.(lower!, Math.max(hu, lower! + 10));
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const r = canvasRef.current!.getBoundingClientRect();
    move(drag, e.clientX - r.left);
  };
  const onDouble = (e: React.MouseEvent) => {
    if (!data) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const which = pick(e.clientX - r.left);
    if (which === 'threshold') {
      if (defaults?.threshold !== undefined) onThreshold?.(defaults.threshold);
    } else if (which === 'lower') {
      onChange?.(Math.min(defaults?.lower ?? data.minHu, upper! - 10), upper!);
    } else {
      onChange?.(lower!, Math.max(defaults?.upper ?? data.maxHu, lower! + 10));
    }
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        onDoubleClick={onDouble}
        style={{
          width: '100%',
          height: H,
          borderRadius: 4,
          border: '1px solid var(--border)',
          cursor: drag ? 'ew-resize' : 'pointer',
          touchAction: 'none',
          display: 'block',
        }}
        title={
          thresholdMode
            ? 'drag the line: the 3D render keeps only densities to its right · double-click = reset'
            : 'drag the black/white lines: below black renders black, above white renders white · double-click a line = reset'
        }
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
        {thresholdMode ? (
          <>
            <span>transparent ◂</span>
            <span>opacity threshold {threshold} {unit} ▸ rendered</span>
          </>
        ) : (
          <>
            <span>◂ black {lower} {unit}</span>
            <span>white {upper} {unit} ▸</span>
          </>
        )}
      </div>
    </div>
  );
}
