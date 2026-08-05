'use client';
// The PANO workflow: DRAW the dental arch on the axial slice in one
// freehand stroke (lasso) — the curved pano + perpendicular cross-sections reconstruct live.
// A short click still adds/edits single control points (drag to move; double-click OR
// right-click a dot to delete it; "Delete arch" removes the whole line).
//
// Riding on top:
//   - section controls: count, along-arch thickness, mirror, vertical data range;
//   - pano depth: radius shift (slide the layer buccal/lingual), multi-layer pano stack,
//     one-click auto-adjust (pano-local window + sharpening), auto-focus (the layer bends
//     to follow the sharpest anatomy);
//   - nerve / root-canal tracing: 3D polylines in VOLUME space, projected live onto the
//     pano (colored line), every cross-section (crossing dot), and the axial editor;
//   - measurements (true mm) on the pano and cross-sections.
// Traces + measurements persist in the shared evidence sidecar; the arch stays in
// localStorage. Pure canvas rendering off the shared HU volume cache — no Cornerstone here.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadVolumeData, type CbctMeta, type VolumeEntry } from './volumeData';
import {
  buildArchCurve,
  renderPano,
  renderSection,
  drawImage,
  toImageData,
  axialSlice,
  autoWindow,
  sharpenImage,
  autoFocusOffsets,
  autoFitArch,
  type ArchPoint,
  type ReformatImage,
  type ZRange,
} from './curvedReformat';
import {
  newTrace,
  projectTrace,
  sectionCrossing,
  panoToVolume,
  insertOrdered,
  sanitizeTraces,
  type NerveTrace,
} from './traces';
import { fetchEvidence, mergeEvidence } from './evidence';
import DragDivider from './DragDivider';
import { snapshotPaneCanvases, type SnapRef } from './SnapshotButton';
import { Ruler } from 'lucide-react';
import { sweepDeg } from './CbctGrid';
import { renderOblique, type V3 } from './oblique';

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

const ARCH_KEY = (anon: string) => `cbctscope-arch:v1:${anon}`;
// Overlay palette tuned to the MPR refline vibrancy (more saturated,
// NOT bolder — line widths unchanged; the old muted golds/washed cyans read too flat).
const ACCENT = 'rgba(85,150,255,0.95)';
const MARKER = 'rgba(235,205,45,0.95)';
const MARKER_DIM = 'rgba(235,205,45,0.5)';
const ZLINE = 'rgba(90,200,255,0.9)';
const MEASURE = 'rgba(120,255,170,0.95)';
const SLAB_GUIDE = 'rgba(70,220,95,0.95)'; // pano slab envelope — MPR-green, distinct from the yellow markers
const LAYER_GAP = 3; // px between stacked pano layers

interface Persisted {
  points: ArchPoint[];
  archZ: number;
  /** true once placement was finished (double-click / auto-arch / freehand) — the arch is
   *  then FINISHED: clicks never add dots, the line drags as a whole. */
  done?: boolean;
  /** the arch as of its last FINISH event — "reset arch" returns here after exploratory
   *  dot / whole-arch drags (drags do NOT move home; only a new finish does) */
  home?: { points: ArchPoint[]; archZ: number };
}

/** A true-mm measurement on a reformat surface. Pano: (s, z) mm. Section: (offset, z) mm,
 *  anchored to the arc position it was drawn at (shows on a section within ±1 mm of it). */
interface PanoMeasure {
  id: string;
  surface: 'pano' | 'section';
  s?: number;
  a: [number, number];
  b: [number, number];
}

function sanitizeMeasures(raw: unknown): PanoMeasure[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is PanoMeasure =>
      !!m &&
      typeof (m as PanoMeasure).id === 'string' &&
      ((m as PanoMeasure).surface === 'pano' || (m as PanoMeasure).surface === 'section') &&
      Array.isArray((m as PanoMeasure).a) &&
      Array.isArray((m as PanoMeasure).b),
  );
}

function loadArch(anon: string): Persisted | null {
  try {
    const raw = localStorage.getItem(ARCH_KEY(anon));
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

/** Uniformly resample a freehand stroke (mm polyline) down to a few control points. */
function simplifyStroke(stroke: ArchPoint[]): ArchPoint[] {
  if (stroke.length < 2) return stroke;
  const cum = [0];
  for (let i = 1; i < stroke.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y));
  }
  const total = cum[cum.length - 1];
  const k = Math.max(5, Math.min(13, Math.round(total / 11))); // one control point ≈ every 11 mm
  const out: ArchPoint[] = [];
  let seg = 0;
  for (let i = 0; i < k; i++) {
    const s = (i / (k - 1)) * total;
    while (seg < stroke.length - 2 && cum[seg + 1] < s) seg++;
    const span = cum[seg + 1] - cum[seg] || 1;
    const f = (s - cum[seg]) / span;
    out.push({
      x: stroke[seg].x + f * (stroke[seg + 1].x - stroke[seg].x),
      y: stroke[seg].y + f * (stroke[seg + 1].y - stroke[seg].y),
    });
  }
  return out;
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

/**
 * Vertical crop on the right edge of the pano: TWO separate native vertical
 * sliders. The first crops from ABOVE — its thumb rests at the top, drag it down. The
 * second crops from BELOW — thumb rests at the bottom, drag it up. value = that boundary's
 * fraction of the full z extent; writingMode vertical-lr + direction rtl puts max at the
 * top (same recipe as the axial ITS slider). The pano PANE is fixed by the pane split —
 * cropping re-renders just the kept band, which scales to fit the frame (see zRange).
 */
export function VertRangeSliders({
  zFrac,
  setZFrac,
  verb = 'crop',
  noun = 'the kept window',
}: {
  zFrac: [number, number];
  setZFrac: React.Dispatch<React.SetStateAction<[number, number]>>;
  /** tooltip wording — Region BOUNDS the grow rather than cropping a view, so the generic
      "crop the kept height" would be wrong there */
  verb?: string;
  noun?: string;
}) {
  const vertical: React.CSSProperties = {
    writingMode: 'vertical-lr',
    direction: 'rtl',
    width: 18,
    height: '100%',
    margin: 0,
  };
  return (
    <div style={{ display: 'flex', flexShrink: 0 }}>
      {/* Caption strip so the sliders are discoverable — reads top-to-bottom beside them. */}
      <div
        title={`vertical range — ${verb} the height: left slider from above, right slider from below · double-click a slider resets its end`}
        style={{
          writingMode: 'vertical-lr',
          fontSize: 10,
          letterSpacing: 1.5,
          color: 'var(--text-dim)',
          textAlign: 'center',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          padding: '0 1px',
          cursor: 'default',
        }}
      >
        ↕ vertical range
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(zFrac[1] * 100)}
        title={`${verb} from above — drag the handle down (top of ${noun}: ${Math.round(zFrac[1] * 100)}%) · double-click resets`}
        onChange={(e) => {
          const v = Number(e.target.value) / 100;
          setZFrac((cur) => [cur[0], Math.max(v, cur[0] + 0.05)]);
        }}
        onDoubleClick={() => setZFrac((cur) => [cur[0], 1])}
        style={vertical}
      />
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(zFrac[0] * 100)}
        title={`${verb} from below — drag the handle up (bottom of ${noun}: ${Math.round(zFrac[0] * 100)}%) · double-click resets`}
        onChange={(e) => {
          const v = Number(e.target.value) / 100;
          setZFrac((cur) => [Math.min(v, cur[1] - 0.05), cur[1]]);
        }}
        onDoubleClick={() => setZFrac((cur) => [0, cur[1]])}
        style={vertical}
      />
    </div>
  );
}

export default function CbctPano({ anon, voi, invert, gamma, onMeta, onError, snapRef }: Props) {
  const [entry, setEntry] = useState<VolumeEntry | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [points, setPoints] = useState<ArchPoint[]>([]);
  const [stroke, setStroke] = useState<ArchPoint[] | null>(null); // live freehand stroke
  const [archZ, setArchZ] = useState(0);
  const [sPos, setSPos] = useState(0); // mm along the curve (cross-section center)
  const [panoSlab, setPanoSlab] = useState(15);
  const [mip, setMip] = useState(false);
  const [sectionWidth, setSectionWidth] = useState(24);
  const [sectionSpacing, setSectionSpacing] = useState(3);
  const [hoverIdx, setHoverIdx] = useState(-1); // control point under the cursor
  // Arch lifecycle: PLACING (clicks add dots, stroke draws) until a
  // double-click finishes it — then FINISHED: clicks are inert, dots drag individually,
  // grabbing the LINE (not a dot) drags the whole arch. No dot-adding once finished;
  // redraw = Delete arch first. Auto-arch / freehand / a saved arch land finished.
  const [archDone, setArchDone] = useState(false);
  const [hoverLine, setHoverLine] = useState(false); // finished-arch line under the cursor
  // the "main" arch = the shape at the last finish; exploratory drags don't move it
  const [archHome, setArchHome] = useState<{ points: ArchPoint[]; archZ: number } | null>(null);
  // recoverable states (auto-arch missing the teeth) surface HERE, inline — never through
  // onError, which replaces the whole pane and takes the axial view the fix needs with it
  const [hint, setHint] = useState<string | null>(null);

  // Section controls + vertical range
  const [nSections, setNSections] = useState(5);
  const [sectionThickness, setSectionThickness] = useState(0.5);
  const [mirror, setMirror] = useState(false);
  // Section rotation: the MPR/grid right-drag, section edition — ONE
  // shared in-plane tilt for the whole fan (the grid rotates its stack together too).
  const [sectionTilt, setSectionTilt] = useState(0);
  const tilted = Math.abs(sectionTilt) > 0.01; // the whole frame is oblique — see below
  const [rotChip, setRotChip] = useState<string | null>(null); // live drag readout
  const rotRef = useRef<{ lastX: number; lastY: number; px: number; py: number; totalDeg: number; tilt0: number } | null>(null);
  const rotConsumedRef = useRef(false); // a real drag happened — the contextmenu at release must not delete
  const [zFrac, setZFrac] = useState<[number, number]>([0, 1]); // kept z window, fractions
  // pane splits (drag the dividers): axial column's width share · pano's share of the
  // right column's flexible height (the rest goes to the cross-sections)
  const [leftFrac, setLeftFrac] = useState(0.34);
  const [panoFrac, setPanoFrac] = useState(0.5);

  // Pano depth
  const [radiusShift, setRadiusShift] = useState(0);
  const [nLayers, setNLayers] = useState(1);
  const [layerSpacing, setLayerSpacing] = useState(2);
  const [panoVoi, setPanoVoi] = useState<{ center: number; width: number } | null>(null);
  const [sharpenAmt, setSharpenAmt] = useState(0);
  const [focusOffsets, setFocusOffsets] = useState<Float32Array | null>(null);
  const [panoLayers, setPanoLayers] = useState<{ img: ReformatImage; off: number }[]>([]);

  // Traces · measurements
  const [traces, setTraces] = useState<NerveTrace[]>([]);
  const [activeTraceId, setActiveTraceId] = useState<string | null>(null);
  const [measures, setMeasures] = useState<PanoMeasure[]>([]);
  const [measureMode, setMeasureMode] = useState(false);
  const [draft, setDraft] = useState<PanoMeasure | null>(null);
  const evidenceLoadedRef = useRef(false);

  const axialCv = useRef<HTMLCanvasElement | null>(null);
  const panoCv = useRef<HTMLCanvasElement | null>(null);
  const sectionCvs = useRef<(HTMLCanvasElement | null)[]>([]);
  const gridRef = useRef<HTMLDivElement | null>(null); // pane-divider geometry hosts
  const panoAreaRef = useRef<HTMLDivElement | null>(null);
  const sectionsAreaRef = useRef<HTMLDivElement | null>(null);
  const dragIdx = useRef<number>(-1);
  const dragAllRef = useRef<ArchPoint | null>(null); // whole-arch drag: last pointer pos (mm)
  const lastAppendRef = useRef<number>(0); // when the last click-appended dot landed
  const strokeRef = useRef<ArchPoint[] | null>(null);
  const draftRef = useRef<PanoMeasure | null>(null);

  // ---- volume load (usually a cache hit from the MPR view)
  useEffect(() => {
    let stale = false;
    setEntry(null);
    setProgress(0);
    evidenceLoadedRef.current = false;
    setTraces([]);
    setMeasures([]);
    setActiveTraceId(null);
    setFocusOffsets(null);
    setPanoVoi(null);
    setSharpenAmt(0);
    setSectionTilt(0); // a tilt belongs to the volume it was set on
    loadVolumeData(anon, (f) => !stale && setProgress(Math.min(0.95, f)))
      .then(async (e) => {
        if (stale) return;
        setEntry(e);
        onMeta?.(e.meta);
        const saved = loadArch(anon);
        const savedPts = saved?.points?.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ?? [];
        const savedZ = saved?.archZ ?? Math.round(e.meta.dims[2] * 0.45);
        const savedDone = saved?.done ?? savedPts.length >= 3; // pre-`done` saves: full curve = finished
        setPoints(savedPts);
        setArchDone(savedDone);
        setArchZ(savedZ);
        // pre-`home` saves: the stored arch itself is the best available home
        setArchHome(saved?.home ?? (savedDone && savedPts.length >= 3 ? { points: savedPts, archZ: savedZ } : null));
        setProgress(null);
        // traces + pano measurements come back from the shared evidence sidecar
        try {
          const ev = await fetchEvidence(anon);
          if (!stale && ev) {
            setTraces(sanitizeTraces(ev.traces));
            setMeasures(sanitizeMeasures((ev as unknown as { panoMeasures?: unknown }).panoMeasures));
          }
        } catch {
          /* no sidecar yet */
        }
        if (!stale) evidenceLoadedRef.current = true;
      })
      .catch((err) => {
        console.error('[cbct-pano] load failed', err);
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

  // ---- persist arch (debounced, localStorage) + traces/measures (debounced, sidecar)
  useEffect(() => {
    if (!entry) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          ARCH_KEY(anon),
          JSON.stringify({ points, archZ, done: archDone, home: archHome ?? undefined }),
        );
      } catch {
        /* storage full */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [points, archZ, archDone, archHome, anon, entry]);

  const evidencePendingRef = useRef(false);
  const tracesRef = useRef(traces);
  tracesRef.current = traces;
  const measuresRef = useRef(measures);
  measuresRef.current = measures;
  useEffect(() => {
    if (!evidenceLoadedRef.current) return; // never write an empty set over a not-yet-loaded sidecar
    evidencePendingRef.current = true;
    const t = setTimeout(() => {
      evidencePendingRef.current = false;
      void mergeEvidence(anon, { traces, panoMeasures: measures } as never).then((ok) => {
        if (!ok) console.warn('[cbct-pano] evidence save failed');
      });
    }, 800);
    return () => clearTimeout(t);
  }, [traces, measures, anon]);
  // FLUSH on leave: the debounce above drops a pending save when the volume changes or the
  // view unmounts — an edit made <800 ms before switching would be silently lost. This
  // cleanup runs BEFORE the new volume's load effect resets state, so the refs still hold
  // the leaving volume's data and `anon` (closure) is still the leaving volume's id.
  useEffect(() => {
    return () => {
      if (evidencePendingRef.current && evidenceLoadedRef.current) {
        evidencePendingRef.current = false;
        void mergeEvidence(anon, {
          traces: tracesRef.current,
          panoMeasures: measuresRef.current,
        } as never);
      }
    };
  }, [anon]);

  const effVoi = useMemo(
    () => voi ?? entry?.meta.defaultVoi ?? { center: 300, width: 2500 },
    [voi, entry],
  );
  const panoEffVoi = panoVoi ?? effVoi;
  const spacing = entry?.meta.spacing ?? [0.2, 0.2, 0.2];
  const sx = spacing[0];
  const spz = spacing[2];
  const slices = entry?.meta.dims[2] ?? 1;

  // vertical data range in slice indices (inclusive). The reformat renders ONLY the kept
  // band; the pano PANE is fixed by the pane split, so cropping scales the kept band to
  // fit the frame without moving anything (crop the image, not the pane).
  const zRange = useMemo<ZRange>(() => {
    const zLo = Math.round(zFrac[0] * (slices - 1));
    const zHi = Math.max(zLo + 3, Math.round(zFrac[1] * (slices - 1)));
    return { zLo, zHi: Math.min(slices - 1, zHi) };
  }, [zFrac, slices]);

  const curve = useMemo(
    () => (entry ? buildArchCurve(points, Math.max(sx, 0.1)) : null),
    [entry, points, sx],
  );

  // arch edits move the anatomy under a computed focus layer — recompute on demand only
  useEffect(() => {
    setFocusOffsets(null);
  }, [curve]);

  // first curve → default cross-section position at mid-arch
  useEffect(() => {
    if (curve && (sPos === 0 || !Number.isFinite(sPos) || sPos > curve.length)) setSPos(curve.length / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curve?.length]);

  // ---- pano recompute (debounced): one image per layer, sharpened if auto-adjust says so
  useEffect(() => {
    if (!entry || !curve) {
      setPanoLayers([]);
      return;
    }
    const t = setTimeout(() => {
      const offs =
        nLayers === 1
          ? [0]
          : Array.from({ length: nLayers }, (_, k) => (k - (nLayers - 1) / 2) * layerSpacing);
      const layers = offs.map((off) => {
        let img = renderPano(entry, curve, panoSlab, mip, {
          shiftMm: radiusShift + off,
          focusOffsets,
          range: zRange,
          tiltDeg: sectionTilt, // rigid frame: the pano leans with the section fan
        });
        if (sharpenAmt > 0) img = sharpenImage(img, sharpenAmt);
        return { img, off };
      });
      setPanoLayers(layers);
    }, 120);
    return () => clearTimeout(t);
  }, [entry, curve, panoSlab, mip, nLayers, layerSpacing, radiusShift, focusOffsets, sharpenAmt, zRange, sectionTilt]);

  const zRowOf = useCallback(
    (zSlice: number): number | null => {
      if (zSlice < zRange.zLo || zSlice > zRange.zHi) return null;
      return zRange.zHi - zSlice;
    },
    [zRange],
  );


  // trace projections against the CURRENT curve (recomputed when either changes)
  const projected = useMemo(() => {
    if (!curve) return new Map<string, ReturnType<typeof projectTrace>>();
    const m = new Map<string, ReturnType<typeof projectTrace>>();
    for (const t of traces) if (t.visible) m.set(t.id, projectTrace(t, curve));
    return m;
  }, [traces, curve]);

  // ---- draw: axial editor (slice + spline/stroke + points + section markers + traces)
  useEffect(() => {
    const cv = axialCv.current;
    if (!cv || !entry) return;
    if (tilted && curve) {
      // Rigid frame, scout edition: the axial re-cuts as an OBLIQUE plane ⊥ the tilted
      // section axis, rotated about the arch tangent at the current section position —
      // the implant-workflow read. renderOblique is the shared sampler (grid/TMJ/
      // reslice bar). Arch overlays/editing pause until upright (their xy geometry
      // lives in the upright plane).
      const i = Math.max(0, Math.min(curve.count - 1, Math.round(sPos / curve.step)));
      const [vsx, vsy] = entry.meta.spacing;
      const th = (sectionTilt * Math.PI) / 180;
      const norm = (v: V3): V3 => {
        const L = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / L, v[1] / L, v[2] / L];
      };
      // voxel-space unit dirs (CBCT voxels are isotropic; normalize regardless)
      const N = norm([curve.normals[2 * i] / vsx, curve.normals[2 * i + 1] / vsy, 0]);
      const U = norm([-Math.sin(th) * N[0], -Math.sin(th) * N[1], Math.cos(th)]); // tilted up-axis
      // image axes: keep patient orientation as close to the upright scout as possible
      const seed: V3 = Math.abs(U[0]) > 0.94 ? [0, 1, 0] : [1, 0, 0];
      const dotSU = seed[0] * U[0] + seed[1] * U[1] + seed[2] * U[2];
      const u = norm([seed[0] - dotSU * U[0], seed[1] - dotSU * U[1], seed[2] - dotSU * U[2]]);
      const v: V3 = [
        U[1] * u[2] - U[2] * u[1],
        U[2] * u[0] - U[0] * u[2],
        U[0] * u[1] - U[1] * u[0],
      ];
      const dims = entry.meta.dims;
      const P: V3 = [curve.pts[2 * i] / vsx, curve.pts[2 * i + 1] / vsy, archZ];
      const off =
        (P[0] - dims[0] / 2) * U[0] + (P[1] - dims[1] / 2) * U[1] + (P[2] - dims[2] / 2) * U[2];
      const idata = renderOblique(
        entry,
        { u, v, n: U },
        off,
        1,
        false,
        effVoi.center - effVoi.width / 2,
        effVoi.center + effVoi.width / 2,
        invert,
        gamma,
      );
      cv.width = idata.width;
      cv.height = idata.height;
      const octx = cv.getContext('2d')!;
      octx.putImageData(idata, 0, 0);

      // TRUE projections onto the oblique plane (arch + traces stay
      // visible while tilted). Inverse of renderOblique's pixel mapping: col/row =
      // (Q − volumeCenter)·u/v + half-extent.
      const C0 = dims[0] / 2;
      const C1 = dims[1] / 2;
      const C2 = dims[2] / 2;
      const toImg = (qx: number, qy: number, qz: number): [number, number] => [
        (qx - C0) * u[0] + (qy - C1) * u[1] + (qz - C2) * u[2] + idata.width / 2,
        (qx - C0) * v[0] + (qy - C1) * v[1] + (qz - C2) * v[2] + idata.height / 2,
      ];
      // The arch is a vertical CURTAIN through its (x,y) line — its intersection with this
      // plane is a real curve (z solved per sample from the plane equation), drawn dashed
      // + dimmed so it reads as a projection, not an editable line.
      const spzV = entry.meta.spacing[2];
      octx.globalAlpha = 0.55;
      octx.strokeStyle = ACCENT;
      octx.lineWidth = 1.5;
      octx.setLineDash([7, 5]);
      octx.beginPath();
      for (let k2 = 0; k2 < curve.count; k2++) {
        const qx = curve.pts[2 * k2] / vsx;
        const qy = curve.pts[2 * k2 + 1] / vsy;
        const qz = C2 + (off - (qx - C0) * U[0] - (qy - C1) * U[1]) / U[2];
        const [ix, iy] = toImg(qx, qy, qz);
        if (k2 === 0) octx.moveTo(ix, iy);
        else octx.lineTo(ix, iy);
      }
      octx.stroke();
      octx.setLineDash([]);
      for (const p of points) {
        const qx = p.x / vsx;
        const qy = p.y / vsy;
        const qz = C2 + (off - (qx - C0) * U[0] - (qy - C1) * U[1]) / U[2];
        const [ix, iy] = toImg(qx, qy, qz);
        octx.fillStyle = ACCENT;
        octx.beginPath();
        octx.arc(ix, iy, 3, 0, Math.PI * 2);
        octx.fill();
      }
      // traces: orthogonal projection onto the plane, same near/far emphasis as the
      // upright scout (solid within ±2 mm of the plane, dim beyond)
      for (const t of traces) {
        if (!t.visible || t.points.length === 0) continue;
        octx.fillStyle = t.color;
        for (const [x, y, z] of t.points) {
          const qx = x / vsx;
          const qy = y / vsy;
          const qz = z / spzV;
          const dist = (qx - C0) * U[0] + (qy - C1) * U[1] + (qz - C2) * U[2] - off;
          const near = Math.abs(dist * vsx) <= 2; // isotropic voxels: voxel dist ≈ mm/vsx
          const [ix, iy] = toImg(qx - dist * U[0], qy - dist * U[1], qz - dist * U[2]);
          octx.globalAlpha = near ? 0.95 : 0.3;
          octx.beginPath();
          octx.arc(ix, iy, near ? 3.5 : 2.5, 0, Math.PI * 2);
          octx.fill();
        }
      }
      octx.globalAlpha = 1;
      return;
    }
    const img = axialSlice(entry, archZ);
    drawImage(cv, img, effVoi, invert, gamma);
    const ctx = cv.getContext('2d')!;
    if (stroke && stroke.length > 1) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      stroke.forEach((p, i) => {
        const x = p.x / img.pxW;
        const y = p.y / img.pxH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      return; // while drawing, show only the stroke
    }
    if (curve) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < curve.count; i++) {
        const x = curve.pts[2 * i] / img.pxW;
        const y = curve.pts[2 * i + 1] / img.pxH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // pano slab envelope: two curves flanking the band the pano actually
      // samples — centered on the rendered layer (radius shift + the auto-focus bend),
      // half-width = slab/2 widened by the outer layers of a stack — CLOSED at both arch
      // ends (one path: out along one side, back along the other, end caps for free).
      // Reacts live to the slab / radius-shift / layers sliders.
      const halfBand = panoSlab / 2 + ((nLayers - 1) / 2) * layerSpacing;
      const offPt = (i: number, side: number): [number, number] => {
        const bend = radiusShift + (focusOffsets && i < focusOffsets.length ? focusOffsets[i] : 0);
        const off = bend + side * halfBand;
        return [
          (curve.pts[2 * i] + curve.normals[2 * i] * off) / img.pxW,
          (curve.pts[2 * i + 1] + curve.normals[2 * i + 1] * off) / img.pxH,
        ];
      };
      ctx.strokeStyle = SLAB_GUIDE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < curve.count; i++) {
        const [x, y] = offPt(i, 1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = curve.count - 1; i >= 0; i--) {
        const [x, y] = offPt(i, -1);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      // full section lines along the arch normals, numbered
      const idx = Math.round(sPos / curve.step);
      const half = (sectionWidth * 0.75) / img.pxW; // draw a bit past the sampled width
      for (let k = 0; k < nSections; k++) {
        const off = (k - (nSections - 1) / 2) * sectionSpacing;
        const i = Math.max(0, Math.min(curve.count - 1, idx + Math.round(off / curve.step)));
        const cx = curve.pts[2 * i] / img.pxW;
        const cy = curve.pts[2 * i + 1] / img.pxH;
        const nx = curve.normals[2 * i] * half;
        const ny = curve.normals[2 * i + 1] * half;
        ctx.strokeStyle = off === 0 ? MARKER : MARKER_DIM;
        ctx.lineWidth = off === 0 ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(cx - nx, cy - ny);
        ctx.lineTo(cx + nx, cy + ny);
        ctx.stroke();
        ctx.fillStyle = off === 0 ? MARKER : MARKER_DIM;
        ctx.font = '10px sans-serif';
        ctx.fillText(String(k + 1), cx + nx + 3, cy + ny + 3);
      }
    }
    // traces: (x, y) dots, solid within ±2 mm of this slice, dim elsewhere
    for (const t of traces) {
      if (!t.visible || t.points.length === 0) continue;
      for (const [x, y, z] of t.points) {
        const near = Math.abs(z / spz - archZ) * spz <= 2;
        ctx.fillStyle = t.color;
        ctx.globalAlpha = near ? 0.95 : 0.3;
        ctx.beginPath();
        ctx.arc(x / img.pxW, y / img.pxH, near ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    for (const [i, p] of points.entries()) {
      const x = p.x / img.pxW;
      const y = p.y / img.pxH;
      const hovered = i === hoverIdx;
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(x, y, hovered ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      if (hovered) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.fillText(String(i + 1), x + 8, y - 5);
      if (hovered) {
        ctx.fillStyle = 'rgba(230,233,239,0.9)';
        ctx.font = '9px sans-serif';
        ctx.fillText('drag = move · dbl/right-click = delete', x + 8, y + 12);
      }
    }
  }, [entry, archZ, effVoi, invert, gamma, curve, points, stroke, sPos, sectionSpacing, sectionWidth, hoverIdx, nSections, traces, spz, panoSlab, radiusShift, nLayers, layerSpacing, focusOffsets, tilted, sectionTilt]);

  // ---- draw: pano layer stack + section lines + z-level + ruler + traces + measurements
  useEffect(() => {
    const cv = panoCv.current;
    if (!cv) return;
    if (!panoLayers.length) {
      cv.width = 640;
      cv.height = 170;
      const ctx = cv.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.fillStyle = '#9aa3b2';
        ctx.font = '13px sans-serif';
        ctx.fillText('Draw the dental arch on the axial slice in ONE stroke (freehand),', 20, 76);
        ctx.fillText('or click ≥ 3 points along it — or press “auto arch”. The pano reconstructs live.', 20, 96);
      }
      return;
    }
    const first = panoLayers[0].img;
    const bandH = first.height;
    cv.width = first.width;
    cv.height = panoLayers.length * bandH + (panoLayers.length - 1) * LAYER_GAP;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, cv.width, cv.height);

    panoLayers.forEach(({ img, off }, b) => {
      const top = b * (bandH + LAYER_GAP);
      ctx.putImageData(toImageData(img, panoEffVoi, invert, gamma), 0, top);
      // per-band overlays
      if (curve) {
        const idx = sPos / img.pxW;
        for (let k = 0; k < nSections; k++) {
          const soff = (k - (nSections - 1) / 2) * sectionSpacing;
          const x = idx + soff / img.pxW;
          ctx.strokeStyle = soff === 0 ? MARKER : MARKER_DIM;
          ctx.lineWidth = soff === 0 ? 1.5 : 1;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, top + bandH);
          ctx.stroke();
          if (b === 0) {
            ctx.fillStyle = soff === 0 ? MARKER : MARKER_DIM;
            ctx.font = '10px sans-serif';
            ctx.fillText(String(k + 1), x + 2, top + 12);
          }
        }
      }
      // z-mapped overlays hide while the frame is tilted (rows are no longer one z each)
      const zr = tilted ? null : zRowOf(archZ);
      if (zr !== null) {
        ctx.strokeStyle = ZLINE;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(0, top + zr);
        ctx.lineTo(cv.width, top + zr);
        ctx.stroke();
        ctx.setLineDash([]);
        if (b === 0) {
          ctx.fillStyle = ZLINE;
          ctx.font = '9px sans-serif';
          ctx.fillText('axial', 4, top + zr - 3);
        }
      }
      // traces: projected polyline (s → x; the row is the TRUE projection onto this band's
      // leaning surface — dN·sinθ − dZ·cosθ about the kept-window center, which reduces to
      // the plain z row at 0°, and honestly shifts a buccal/lingual canal when tilted)
      {
        const th = (sectionTilt * Math.PI) / 180;
        const sinT = Math.sin(th);
        const cosT = Math.cos(th);
        const zCmm = ((zRange.zLo + zRange.zHi) / 2) * spz;
        const yOf = (p: { s: number; offset: number; z: number }): number => {
          const ci = Math.max(0, Math.min(curve!.count - 1, Math.round(p.s / curve!.step)));
          const focus = focusOffsets ? focusOffsets[Math.min(ci, focusOffsets.length - 1)] : 0;
          const dN = p.offset - (radiusShift + off + focus);
          const dZ = p.z - zCmm;
          return top + (bandH - 1) / 2 + (dN * sinT - dZ * cosT) / spz;
        };
        for (const t of traces) {
          if (!t.visible) continue;
          const proj = projected.get(t.id);
          if (!proj || proj.length === 0) continue;
          ctx.strokeStyle = t.color;
          ctx.fillStyle = t.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          proj.forEach((p, i) => {
            const x = p.s / img.pxW;
            const y = yOf(p);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          if (proj.length > 1) ctx.stroke();
          for (const p of proj) {
            ctx.beginPath();
            ctx.arc(p.s / img.pxW, yOf(p), t.id === activeTraceId ? 3.5 : 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
          if (b === 0 && proj.length > 0) {
            ctx.font = '10px sans-serif';
            ctx.fillText(t.name, proj[0].s / img.pxW + 5, yOf(proj[0]) - 5);
          }
        }
      }
      // measurements on the pano surface
      const drawMeasure = (m: PanoMeasure, isDraft: boolean) => {
        const x1 = m.a[0] / img.pxW;
        const y1 = top + (zRange.zHi - m.a[1] / spz);
        const x2 = m.b[0] / img.pxW;
        const y2 = top + (zRange.zHi - m.b[1] / spz);
        ctx.strokeStyle = MEASURE;
        ctx.fillStyle = MEASURE;
        ctx.lineWidth = isDraft ? 1 : 1.6;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        const mm = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]);
        ctx.font = '11px sans-serif';
        ctx.fillText(`${mm.toFixed(1)} mm`, (x1 + x2) / 2 + 4, (y1 + y2) / 2 - 4);
      };
      for (const m of tilted ? [] : measures) if (m.surface === 'pano') drawMeasure(m, false);
      if (!tilted && draft?.surface === 'pano') drawMeasure(draft, true);
      // band label (layer offset)
      if (panoLayers.length > 1) {
        ctx.fillStyle = 'rgba(230,233,239,0.85)';
        ctx.font = '10px sans-serif';
        ctx.fillText(off === 0 ? 'layer 0' : `${off > 0 ? '+' : ''}${off.toFixed(1)} mm`, cv.width - 62, top + 12);
      }
    });

    // ruler on the bottom band only: tick every 10 mm of arc length
    const top = (panoLayers.length - 1) * (bandH + LAYER_GAP);
    ctx.strokeStyle = 'rgba(230,233,239,0.7)';
    ctx.fillStyle = 'rgba(230,233,239,0.7)';
    ctx.font = '9px sans-serif';
    for (let mm = 0; mm <= cv.width * first.pxW; mm += 10) {
      const x = mm / first.pxW;
      ctx.beginPath();
      ctx.moveTo(x, top + bandH);
      ctx.lineTo(x, top + bandH - (mm % 50 === 0 ? 10 : 5));
      ctx.stroke();
      if (mm % 50 === 0) ctx.fillText(`${mm}`, x + 2, top + bandH - 12);
    }
  }, [panoLayers, panoEffVoi, invert, gamma, sPos, sectionSpacing, nSections, curve, archZ, zRowOf, zRange, traces, projected, activeTraceId, measures, draft, spz, tilted, sectionTilt, radiusShift, focusOffsets]);

  // ---- draw: cross-sections (+ z-level + center line + trace crossings + measurements)
  useEffect(() => {
    if (!entry || !curve) return;
    for (let k = 0; k < nSections; k++) {
      const cv = sectionCvs.current[k];
      if (!cv) continue;
      const off = (k - (nSections - 1) / 2) * sectionSpacing;
      const s = Math.max(0, Math.min(curve.length, sPos + off));
      const img = renderSection(entry, curve, s, sectionWidth, {
        thicknessMm: sectionThickness,
        mirror,
        shiftMm: radiusShift,
        range: zRange,
        tiltDeg: sectionTilt,
      });
      drawImage(cv, img, effVoi, invert, gamma);
      const ctx = cv.getContext('2d')!;
      ctx.strokeStyle = MARKER_DIM;
      ctx.beginPath();
      ctx.moveTo(img.width / 2, 0);
      ctx.lineTo(img.width / 2, img.height);
      ctx.stroke();
      // z-mapped overlays (axial line, canal crossings, measurements) are only valid on the
      // upright plane — a tilted section hides them rather than mislocating them
      const zr = tilted ? null : zRowOf(archZ);
      if (zr !== null) {
        ctx.strokeStyle = ZLINE;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(0, zr);
        ctx.lineTo(img.width, zr);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // trace crossings: where each canal passes THIS section's plane. The plane itself is
      // tilt-invariant (in-plane spin), so the crossing stays exact — only its image coords
      // rotate: (a, b) = R(−tilt)·(dN, −dZ) about the kept-window center (identity at 0°).
      const sign = mirror ? -1 : 1;
      const thS = (sectionTilt * Math.PI) / 180;
      const sinTS = Math.sin(thS);
      const cosTS = Math.cos(thS);
      const zCmmS = ((zRange.zLo + zRange.zHi) / 2) * spz;
      for (const t of traces) {
        if (!t.visible) continue;
        const proj = projected.get(t.id);
        if (!proj) continue;
        const hit = sectionCrossing(proj, s);
        if (!hit) continue;
        const dN = hit.offset - radiusShift;
        const dZ = hit.z - zCmmS;
        const aIn = dN * cosTS + dZ * sinTS;
        const bIn = dN * sinTS - dZ * cosTS;
        const x = img.width / 2 + (sign * aIn) / sx;
        const y = (img.height - 1) / 2 + bIn / spz;
        if (x < -4 || x > img.width + 4 || y < -4 || y > img.height + 4) continue;
        ctx.strokeStyle = t.color;
        ctx.fillStyle = t.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
      // measurements anchored to this arc position (±1 mm)
      const drawMeasure = (m: PanoMeasure, isDraft: boolean) => {
        const x1 = img.width / 2 + (sign * (m.a[0] - radiusShift)) / sx;
        const y1 = zRange.zHi - m.a[1] / spz;
        const x2 = img.width / 2 + (sign * (m.b[0] - radiusShift)) / sx;
        const y2 = zRange.zHi - m.b[1] / spz;
        ctx.strokeStyle = MEASURE;
        ctx.fillStyle = MEASURE;
        ctx.lineWidth = isDraft ? 1 : 1.6;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        const mm = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]);
        ctx.font = '11px sans-serif';
        ctx.fillText(`${mm.toFixed(1)} mm`, (x1 + x2) / 2 + 4, (y1 + y2) / 2 - 4);
      };
      for (const m of tilted ? [] : measures) {
        if (m.surface === 'section' && m.s !== undefined && Math.abs(m.s - s) <= 1) drawMeasure(m, false);
      }
      if (!tilted && draft?.surface === 'section' && draft.s !== undefined && Math.abs(draft.s - s) <= 1) {
        drawMeasure(draft, true);
      }
      ctx.fillStyle = k === (nSections - 1) / 2 ? MARKER : '#9aa3b2';
      ctx.font = '11px sans-serif';
      ctx.fillText(`${k + 1} · ${s.toFixed(0)} mm${mirror ? ' · mirrored' : ''}`, 4, 12);
    }
  }, [entry, curve, sPos, sectionSpacing, sectionWidth, sectionThickness, mirror, radiusShift, effVoi, invert, gamma, zRowOf, zRange, nSections, traces, projected, measures, draft, sx, spz, archZ, sectionTilt, tilted]);

  // ---- axial interactions: freehand lasso OR click points; drag/dblclick edits; wheel = slice
  const axialPos = useCallback(
    (e: { clientX: number; clientY: number }): ArchPoint | null => {
      const cv = axialCv.current;
      if (!cv || !entry) return null;
      const p = containPos(cv, e);
      if (!p) return null;
      return { x: p.x * entry.meta.spacing[0], y: p.y * entry.meta.spacing[1] };
    },
    [entry],
  );

  const hitPoint = useCallback(
    (p: ArchPoint): number => {
      const thresh = 8 * sx;
      let best = -1;
      let bestD = thresh;
      points.forEach((q, i) => {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    },
    [points, sx],
  );

  // distance-to-curve test in mm (the curve is sampled at ~voxel step, so nearest-sample
  // distance ≈ nearest-curve distance at this threshold) — the whole-arch grab handle
  const hitCurve = useCallback(
    (p: ArchPoint): boolean => {
      if (!curve) return false;
      const thresh = 8 * sx;
      for (let i = 0; i < curve.count; i++) {
        if (Math.hypot(curve.pts[2 * i] - p.x, curve.pts[2 * i + 1] - p.y) < thresh) return true;
      }
      return false;
    },
    [curve, sx],
  );

  const onAxialDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // right button = delete (contextmenu), never draw
    if (tilted) return; // oblique scout — the arch's xy geometry is paused until upright
    const p = axialPos(e);
    if (!p) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const hit = hitPoint(p);
    if (hit >= 0) {
      dragIdx.current = hit; // adjust an existing control point (both phases)
    } else if (archDone) {
      // finished arch: the line grabs the whole arch; empty space is inert (no stray dots)
      if (hitCurve(p)) dragAllRef.current = p;
    } else {
      strokeRef.current = [p]; // start a freehand stroke (resolved as click if it stays short)
      setStroke([p]);
    }
  };
  const onAxialMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (tilted) return; // oblique scout — no hover/drag until upright
    if (dragIdx.current >= 0) {
      const p = axialPos(e);
      if (p) setPoints((pts) => pts.map((q, i) => (i === dragIdx.current ? p : q)));
      return;
    }
    if (dragAllRef.current) {
      const p = axialPos(e);
      if (p) {
        const dx = p.x - dragAllRef.current.x;
        const dy = p.y - dragAllRef.current.y;
        if (dx || dy) {
          setPoints((pts) => pts.map((q) => ({ x: q.x + dx, y: q.y + dy })));
          dragAllRef.current = p;
        }
      }
      return;
    }
    const st = strokeRef.current;
    if (st) {
      const p = axialPos(e);
      if (!p) return;
      const last = st[st.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > sx * 2) {
        st.push(p);
        setStroke([...st]);
      }
      return;
    }
    // idle hover: light up the dot under the cursor; on a finished arch also flag the line
    const p = axialPos(e);
    const dot = p ? hitPoint(p) : -1;
    setHoverIdx(dot);
    setHoverLine(archDone && dot < 0 && !!p && hitCurve(p));
  };
  const onAxialUp = () => {
    dragIdx.current = -1;
    dragAllRef.current = null;
    const st = strokeRef.current;
    strokeRef.current = null;
    setStroke(null);
    if (!st) return;
    const len = st.reduce(
      (acc, p, i) => (i ? acc + Math.hypot(p.x - st[i - 1].x, p.y - st[i - 1].y) : 0),
      0,
    );
    if (len > 12) {
      const drawn = simplifyStroke(st);
      setPoints(drawn); // a real lasso REPLACES the arch (lasso redraw)
      setArchDone(true); // a stroke IS a complete arch — placement ends with it
      if (drawn.length >= 3) setArchHome({ points: drawn, archZ });
    } else {
      setPoints((pts) => [...pts, st[0]]); // a short click appends a control point
      lastAppendRef.current = performance.now();
    }
  };
  const deleteDotAt = (e: { clientX: number; clientY: number }) => {
    const p = axialPos(e);
    if (!p) return;
    const hit = hitPoint(p);
    if (hit >= 0) {
      setPoints((pts) => pts.filter((_, i) => i !== hit));
      setHoverIdx(-1);
    }
  };
  const onAxialDbl = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tilted) return;
    if (archDone) {
      deleteDotAt(e); // finished arch: double-click still deletes the dot under the cursor
      return;
    }
    // placing: double-click FINISHES the arch. Its own first click already appended a
    // stray dot at the cursor (the second click hit that dot, adding nothing) — pop it
    // if fresh; an older dot under the cursor is a deliberate dbl-click-delete instead.
    const p = axialPos(e);
    if (!p) return;
    const hit = hitPoint(p);
    const strayFresh = hit >= 0 && hit === points.length - 1 && performance.now() - lastAppendRef.current < 600;
    if (hit >= 0 && !strayFresh) {
      deleteDotAt(e);
      return;
    }
    const kept = strayFresh ? points.slice(0, -1) : points;
    if (strayFresh) setPoints(kept);
    if (kept.length >= 3) {
      setArchDone(true); // fewer dots = no curve yet, stay placing
      setArchHome({ points: kept, archZ }); // this finish IS the new "main" arch
    }
  };
  const onAxialContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault(); // right-click deletes the dot under the cursor — no browser menu
    if (tilted) return;
    deleteDotAt(e);
  };
  useEffect(() => {
    const cv = axialCv.current;
    if (!cv || !entry) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setArchZ((z) => Math.max(0, Math.min(entry.meta.dims[2] - 1, z + (e.deltaY > 0 ? 1 : -1))));
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [entry]);

  // ---- pano surface coordinates: (s mm along arch, z mm, band index) through the layer stack
  const panoSurfacePos = useCallback(
    (e: { clientX: number; clientY: number }): { s: number; zMm: number; band: number } | null => {
      const cv = panoCv.current;
      if (!cv || !panoLayers.length) return null;
      const p = containPos(cv, e);
      if (!p) return null;
      const img = panoLayers[0].img;
      const bandH = img.height;
      const band = Math.min(panoLayers.length - 1, Math.floor(p.y / (bandH + LAYER_GAP)));
      const yIn = p.y - band * (bandH + LAYER_GAP);
      if (yIn > bandH) return null; // in the gap between layers
      return { s: p.x * img.pxW, zMm: (zRange.zHi - yIn) * spz, band };
    },
    [panoLayers, zRange, spz],
  );

  const activeTrace = traces.find((t) => t.id === activeTraceId) ?? null;

  // pano: tracing beats measuring beats move-the-sections
  const onPanoDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !curve) return;
    const pos = panoSurfacePos(e);
    if (!pos) return;
    if (tilted) {
      // oblique frame: (s, z) surface coords don't apply — moving the section window is
      // still exact (columns stay arc positions); traces/measures wait for upright
      setSPos(Math.max(0, Math.min(curve.length, pos.s)));
      return;
    }
    if (activeTrace) {
      const layerOff = panoLayers[pos.band]?.off ?? 0;
      const idx = Math.max(0, Math.min(curve.count - 1, Math.round(pos.s / curve.step)));
      const focus = focusOffsets ? focusOffsets[Math.min(idx, focusOffsets.length - 1)] : 0;
      const pt = panoToVolume(curve, pos.s, pos.zMm, radiusShift + layerOff + focus);
      setTraces((ts) => ts.map((t) => (t.id === activeTrace.id ? insertOrdered(t, curve, pt) : t)));
      return;
    }
    if (measureMode) {
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      const m: PanoMeasure = {
        id: `pm_${Math.random().toString(36).slice(2, 9)}`,
        surface: 'pano',
        a: [pos.s, pos.zMm],
        b: [pos.s, pos.zMm],
      };
      draftRef.current = m;
      setDraft(m);
      return;
    }
    setSPos(Math.max(0, Math.min(curve.length, pos.s)));
  };
  const onPanoMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = draftRef.current;
    if (!d) return;
    const pos = panoSurfacePos(e);
    if (!pos) return;
    const next = { ...d, b: [pos.s, pos.zMm] as [number, number] };
    draftRef.current = next;
    setDraft(next);
  };
  const onPanoUp = () => {
    const d = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (d && Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) >= 1) setMeasures((ms) => [...ms, d]);
  };
  const onPanoContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!curve || tilted) return; // z-mapped targets are hidden while tilted
    const pos = panoSurfacePos(e);
    if (!pos) return;
    if (activeTrace) {
      // right-click removes the nearest point of the ACTIVE trace (within 3 mm on the surface)
      const proj = projectTrace(activeTrace, curve);
      let best = -1;
      let bestD = 3;
      proj.forEach((p, i) => {
        const dmm = Math.hypot(p.s - pos.s, p.z - pos.zMm);
        if (dmm < bestD) {
          bestD = dmm;
          best = i;
        }
      });
      if (best >= 0) {
        setTraces((ts) =>
          ts.map((t) =>
            t.id === activeTrace.id ? { ...t, points: t.points.filter((_, i) => i !== best) } : t,
          ),
        );
      }
      return;
    }
    // otherwise: delete the nearest pano measurement endpoint (within 3 mm)
    setMeasures((ms) =>
      ms.filter(
        (m) =>
          m.surface !== 'pano' ||
          Math.min(
            Math.hypot(m.a[0] - pos.s, m.a[1] - pos.zMm),
            Math.hypot(m.b[0] - pos.s, m.b[1] - pos.zMm),
          ) > 3,
      ),
    );
  };

  // ---- section surface coordinates: (arc s of the pane, anatomical offset mm, z mm)
  const sectionSurfacePos = useCallback(
    (k: number, e: { clientX: number; clientY: number }): { s: number; offset: number; zMm: number } | null => {
      const cv = sectionCvs.current[k];
      if (!cv || !curve) return null;
      const p = containPos(cv, e);
      if (!p) return null;
      const off = (k - (nSections - 1) / 2) * sectionSpacing;
      const s = Math.max(0, Math.min(curve.length, sPos + off));
      const sign = mirror ? -1 : 1;
      const offset = radiusShift + sign * (p.x - cv.width / 2) * sx;
      return { s, offset, zMm: (zRange.zHi - p.y) * spz };
    },
    [curve, nSections, sectionSpacing, sPos, mirror, radiusShift, sx, zRange, spz],
  );

  const onSectionDown = (k: number) => (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!curve) return;
    if (e.button === 2) {
      // MPR/grid right-drag, section edition: sweep around the grabbed pane's center spins
      // the whole fan in-plane (one shared tilt). A right-CLICK (no real drag) still falls
      // through to the measure delete via the contextmenu handler.
      e.preventDefault();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      rotRef.current = {
        lastX: e.clientX,
        lastY: e.clientY,
        px: r.left + r.width / 2,
        py: r.top + r.height / 2,
        totalDeg: 0,
        tilt0: sectionTilt,
      };
      rotConsumedRef.current = false;
      setRotChip(`tilt ${sectionTilt >= 0 ? '+' : ''}${sectionTilt.toFixed(0)}°`);
      return;
    }
    if (e.button !== 0) return;
    if (Math.abs(sectionTilt) > 0.01) return; // tilted plane: surface coords don't apply — untilt to measure/trace
    const pos = sectionSurfacePos(k, e);
    if (!pos) return;
    if (activeTrace) {
      // the correction workflow: clicking a section SETS the canal point at this
      // section's arc position (exact buccolingual offset + height) — upsert within ±1.5 mm
      const pt = panoToVolume(curve, pos.s, pos.zMm, pos.offset);
      setTraces((ts) =>
        ts.map((t) => {
          if (t.id !== activeTrace.id) return t;
          const proj = projectTrace(t, curve);
          const near = proj.findIndex((p) => Math.abs(p.s - pos.s) <= 1.5);
          if (near >= 0) {
            const points = [...t.points];
            points[near] = pt;
            return { ...t, points };
          }
          return insertOrdered(t, curve, pt);
        }),
      );
      return;
    }
    if (measureMode) {
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
      const m: PanoMeasure = {
        id: `pm_${Math.random().toString(36).slice(2, 9)}`,
        surface: 'section',
        s: pos.s,
        a: [pos.offset, pos.zMm],
        b: [pos.offset, pos.zMm],
      };
      draftRef.current = m;
      setDraft(m);
    }
  };
  const onSectionMove = (k: number) => (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rot = rotRef.current;
    if (rot) {
      const deg = sweepDeg(rot.px, rot.py, rot.lastX, rot.lastY, e.clientX, e.clientY);
      rot.lastX = e.clientX;
      rot.lastY = e.clientY;
      if (!deg) return;
      // mirror flips screen handedness, so the same sweep must apply the opposite way for
      // +drag to keep reading clockwise (the MPR convention)
      rot.totalDeg += mirror ? -deg : deg;
      if (Math.abs(rot.totalDeg) > 1.5) rotConsumedRef.current = true;
      const next = rot.tilt0 + rot.totalDeg;
      setSectionTilt(next);
      setRotChip(`tilt ${next >= 0 ? '+' : ''}${next.toFixed(0)}°`);
      return;
    }
    const d = draftRef.current;
    if (!d || d.surface !== 'section') return;
    const pos = sectionSurfacePos(k, e);
    if (!pos) return;
    const next = { ...d, b: [pos.offset, pos.zMm] as [number, number] };
    draftRef.current = next;
    setDraft(next);
  };
  const onSectionUp = () => {
    if (rotRef.current) {
      rotRef.current = null;
      setRotChip(null);
      return;
    }
    onPanoUp(); // measure drafts finalize exactly as before
  };
  const onSectionContext = (k: number) => (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (rotConsumedRef.current) {
      rotConsumedRef.current = false; // the release of a rotate drag — not a delete
      return;
    }
    if (Math.abs(sectionTilt) > 0.01) return; // tilted: no z-mapped measures visible to delete
    const pos = sectionSurfacePos(k, e);
    if (!pos) return;
    setMeasures((ms) =>
      ms.filter(
        (m) =>
          m.surface !== 'section' ||
          m.s === undefined ||
          Math.abs(m.s - pos.s) > 1 ||
          Math.min(
            Math.hypot(m.a[0] - pos.offset, m.a[1] - pos.zMm),
            Math.hypot(m.b[0] - pos.offset, m.b[1] - pos.zMm),
          ) > 3,
      ),
    );
  };

  // wheel on pano/sections steps the position along the arch
  useEffect(() => {
    if (!curve) return;
    const els = [panoCv.current, ...sectionCvs.current].filter(Boolean) as HTMLCanvasElement[];
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setSPos((s) => Math.max(0, Math.min(curve.length, s + (e.deltaY > 0 ? 1 : -1))));
    };
    els.forEach((el) => el.addEventListener('wheel', onWheel, { passive: false }));
    return () => els.forEach((el) => el.removeEventListener('wheel', onWheel));
  }, [curve, nSections]);

  // ---- one-click helpers
  const runAutoArch = () => {
    if (!entry) return;
    const pts = autoFitArch(entry, archZ);
    if (pts) {
      setPoints(pts);
      setArchDone(true); // a proposed arch is a complete arch — land in the finished phase
      setArchHome({ points: pts, archZ });
      setHint(null);
    } else {
      setHint('auto arch found no tooth-bearing anatomy on this slice — scroll to the teeth and retry');
    }
  };
  const runAutoFocus = () => {
    if (!entry || !curve) return;
    setFocusOffsets((cur) => (cur ? null : autoFocusOffsets(entry, curve, 3, zRange)));
  };
  const runAutoAdjust = () => {
    if (panoVoi) {
      setPanoVoi(null);
      setSharpenAmt(0);
      return;
    }
    const center = panoLayers[Math.floor(panoLayers.length / 2)];
    if (!center) return;
    setPanoVoi(autoWindow(center.img));
    setSharpenAmt(0.7);
  };

  const small: React.CSSProperties = { fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' };
  const sliderRow: React.CSSProperties = {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    padding: '4px 2px',
    flexWrap: 'wrap',
  };

  // one snapshot door: the shell header owns the button; this room registers its composer
  useEffect(() => {
    if (!snapRef) return;
    snapRef.current = () =>
      void snapshotPaneCanvases(
        gridRef.current,
        `${anon} · pano · ${new Date().toISOString().slice(0, 10)}`,
        `${anon}_pano.png`,
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

  const panoCursor = activeTrace ? 'copy' : measureMode ? 'crosshair' : 'crosshair';

  return (
    <div
      ref={gridRef}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: `minmax(220px, ${(leftFrac * 100).toFixed(1)}%) 6px 1fr`,
        gap: 6,
        width: '100%',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* left: arch editor + ITS slider + traces panel */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
        <div style={{ position: 'relative', flex: 1, minHeight: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
          <canvas
            ref={axialCv}
            onPointerDown={onAxialDown}
            onPointerMove={onAxialMove}
            onPointerUp={onAxialUp}
            onPointerLeave={() => setHoverIdx(-1)}
            onDoubleClick={onAxialDbl}
            onContextMenu={onAxialContext}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              cursor: hoverIdx >= 0 || hoverLine ? 'grab' : archDone ? 'default' : 'crosshair',
              touchAction: 'none',
              display: 'block',
            }}
          />
          {/* wraps to two lines instead of clipping — right: 30 keeps clear of the
              vslice; the wheel mention was missing entirely */}
          <span style={{ position: 'absolute', top: 6, left: 8, right: 30, ...small, pointerEvents: 'none', whiteSpace: 'normal', lineHeight: 1.4 }}>
            {tilted
              ? `OBLIQUE ${sectionTilt >= 0 ? '+' : ''}${sectionTilt.toFixed(0)}° · scout ⊥ the tilted section axis · arch + canals shown as projections · press upright to edit`
              : `AXIAL ${entry ? `${archZ + 1}/${slices}` : ''} · wheel = slice · ${
                  archDone
                    ? 'arch finished — drag a dot to refine · drag the line to move the whole arch'
                    : 'stroke = draw arch · click = add dot · double-click = finish'
                }`}
          </span>
          <input
            className="vslice"
            type="range"
            min={0}
            max={Math.max(0, slices - 1)}
            step={1}
            value={archZ}
            onChange={(e) => setArchZ(Number(e.target.value))}
            onDoubleClick={() => setArchZ(Math.floor(slices / 2))}
            onPointerDown={(e) => e.stopPropagation()}
            title="arch slice · up = superior (S) · double-click = volume middle"
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
            onClick={() => {
              setPoints([]);
              setArchDone(false); // back to the placing phase — clicks add dots again
              setSectionTilt(0); // the tilt belonged to the frame the arch defined
              setArchHome(null); // and so did the home
            }}
            disabled={points.length === 0}
            title={points.length === 0 ? 'no arch to delete yet' : 'delete the whole arch line — pano and cross-sections clear with it'}
            style={chip(false)}
          >
            delete arch
          </button>
          <button
            onClick={runAutoArch}
            disabled={!entry}
            title="propose the arch from the anatomy of this axial slice (then drag the dots to adjust)"
            style={chip(false)}
          >
            auto arch
          </button>
          <button
            onClick={() => {
              if (!archHome || archHome.points.length < 3) return;
              setPoints(archHome.points.map((p) => ({ ...p })));
              setArchZ(archHome.archZ);
              setArchDone(true);
            }}
            disabled={!archHome}
            title={!archHome ? 'nothing to reset — finish an arch first' : 'put the arch back to its main position (as of the last finish) — undoes dot drags and whole-arch drags'}
            style={chip(false)}
          >
            reset arch
          </button>
          <span style={small}>
            {points.length === 0
              ? 'no arch drawn'
              : archDone
                ? `${points.length} dots · finished — drag dots or the whole line · dbl/right-click dot = delete`
                : `${points.length} dots · placing — double-click to finish`}
          </span>
        </div>
        {hint && (
          <div style={{ fontSize: 11, color: 'var(--warn)', lineHeight: 1.4, whiteSpace: 'normal' }}>⚠ {hint}</div>
        )}

        {/* nerve / root-canal traces — always fully visible (medical dashboard rule) */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
          <div style={{ ...small, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ color: 'var(--text)' }}>Canal traces</span>
            <button style={chip(false)} disabled={!curve} title="start a new nerve-canal trace (IAN)" onClick={() => {
              const t = newTrace(traces, 'nerve');
              setTraces((ts) => [...ts, t]);
              setActiveTraceId(t.id);
            }}>
              + nerve
            </button>
            <button style={chip(false)} disabled={!curve} title="start a new root-canal trace" onClick={() => {
              const t = newTrace(traces, 'root');
              setTraces((ts) => [...ts, t]);
              setActiveTraceId(t.id);
            }}>
              + root canal
            </button>
            <button
              style={chip(!!activeTrace)}
              disabled={!activeTrace}
              title={activeTrace ? 'stop adding points to this trace' : 'no active trace — start one with + nerve / + root canal'}
              onClick={() => setActiveTraceId(null)}
            >
              done tracing
            </button>
          </div>
          {traces.length === 0 && (
            <div style={{ ...small, whiteSpace: 'normal' }}>
              trace the mandibular canal or a root canal: + nerve, then click along it on the pano;
              refine the exact position by clicking on the cross-sections. It shows on every surface.
            </div>
          )}
          {traces.map((t) => (
            <div key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, background: t.color, flexShrink: 0 }} />
              <button
                onClick={() => setActiveTraceId((cur) => (cur === t.id ? null : t.id))}
                title={activeTraceId === t.id ? 'tracing — click pano/sections to add points; click to stop' : 'resume adding points to this trace'}
                style={{ ...chip(activeTraceId === t.id), flex: 1, textAlign: 'left' }}
              >
                {t.name} · {t.points.length} pts{activeTraceId === t.id ? ' · tracing…' : ''}
              </button>
              <button
                style={chip(false)}
                title={t.visible ? 'hide this trace on all surfaces' : 'show this trace'}
                onClick={() => setTraces((ts) => ts.map((x) => (x.id === t.id ? { ...x, visible: !x.visible } : x)))}
              >
                {t.visible ? '👁' : '—'}
              </button>
              <button
                style={chip(false)}
                title="delete this trace"
                onClick={() => {
                  setTraces((ts) => ts.filter((x) => x.id !== t.id));
                  if (activeTraceId === t.id) setActiveTraceId(null);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {activeTrace && (
            <div style={{ ...small, whiteSpace: 'normal', marginTop: 2 }}>
              click along the canal on the PANO (adds points) · click a CROSS-SECTION to set the
              exact buccolingual position there · right-click a point on the pano = delete it
            </div>
          )}
        </div>
      </div>

      {/* draggable divider: axial column ↔ pano/sections column */}
      <DragDivider
        cursor="col-resize"
        title="drag to resize the axial pane vs the pano side · double-click resets"
        style={{ borderRadius: 3, alignSelf: 'stretch' }}
        onMove={(clientX) => {
          const r = gridRef.current?.getBoundingClientRect();
          if (!r || !r.width) return;
          setLeftFrac(Math.min(0.6, Math.max(0.18, (clientX - r.left) / r.width)));
        }}
        onReset={() => setLeftFrac(0.34)}
      />

      {/* right: pano (+ its control rows) over cross-sections (+ theirs) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0, minWidth: 0 }}>
        {/* pano + the two vertical crop sliders on its right edge; the pane's
            height is the user's split (divider below) — cropping scales the kept band to
            fit this fixed frame, it never moves the pane */}
        <div ref={panoAreaRef} style={{ display: 'flex', gap: 4, flex: `${panoFrac} 1 0%`, minHeight: 90 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}>
          <canvas
            ref={panoCv}
            onPointerDown={onPanoDown}
            onPointerMove={onPanoMove}
            onPointerUp={onPanoUp}
            onContextMenu={onPanoContext}
            style={{ width: '100%', height: '100%', display: 'block', cursor: panoCursor, objectFit: 'contain', touchAction: 'none' }}
          />
          <span style={{ position: 'absolute', top: 6, left: 8, ...small, pointerEvents: 'none' }}>
            CURVED PANO · arc-length mm ·{' '}
            {activeTrace ? `tracing ${activeTrace.name} — click along the canal` : measureMode ? 'drag = measure · right-click = delete a measurement' : 'click or wheel to move sections · right-click a measurement = delete'}
          </span>
        </div>
        <VertRangeSliders zFrac={zFrac} setZFrac={setZFrac} />
        </div>
        <div style={sliderRow}>
          <label style={{ ...small, flex: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
            section position along arch {curve ? `${sPos.toFixed(0)}/${curve.length.toFixed(0)} mm` : '—'}
            <input
              type="range"
              min={0}
              max={curve ? curve.length : 1}
              step={0.5}
              value={Math.min(sPos, curve?.length ?? 1)}
              disabled={!curve}
              title={curve ? 'double-click = mid-arch' : 'draw or auto-fit an arch first'}
              onChange={(e) => setSPos(Number(e.target.value))}
              onDoubleClick={() => curve && setSPos(curve.length / 2)}
              style={{ flex: 1 }}
            />
          </label>
          <label style={{ ...small, flex: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
            slab {panoSlab} mm
            <input
              type="range"
              min={2}
              max={40}
              step={1}
              value={panoSlab}
              onChange={(e) => setPanoSlab(Number(e.target.value))}
              onDoubleClick={() => setPanoSlab(15)}
              style={{ flex: 1 }}
            />
          </label>
          <label style={{ ...small, display: 'flex', gap: 4, alignItems: 'center' }} title="brightest voxel across the slab (off = average)">
            <input type="checkbox" checked={mip} onChange={(e) => setMip(e.target.checked)} /> MIP
          </label>
        </div>
        <div style={sliderRow}>
          <span style={small}>layers</span>
          {[1, 3, 5].map((n) => (
            <button key={n} style={chip(nLayers === n)} title={n === 1 ? 'single pano layer' : `${n} parallel layers — flip through the focal trough`} onClick={() => setNLayers(n)}>
              {n}
            </button>
          ))}
          <label style={{ ...small, flex: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
            layer spacing {layerSpacing.toFixed(1)} mm
            <input
              type="range"
              min={0.5}
              max={6}
              step={0.5}
              value={layerSpacing}
              disabled={nLayers === 1}
              title={nLayers === 1 ? 'single-layer pano — pick 3 or 5 layers to space them' : 'double-click = 2 mm'}
              onChange={(e) => setLayerSpacing(Number(e.target.value))}
              onDoubleClick={() => setLayerSpacing(2)}
              style={{ flex: 1 }}
            />
          </label>
          <label style={{ ...small, flex: 1, display: 'flex', gap: 6, alignItems: 'center' }} title="slide the whole sampling layer buccal/lingual without redrawing the arch — double-click to reset">
            radius shift {radiusShift > 0 ? '+' : ''}{radiusShift.toFixed(1)} mm
            <input
              type="range"
              min={-8}
              max={8}
              step={0.5}
              value={radiusShift}
              disabled={!curve}
              onChange={(e) => setRadiusShift(Number(e.target.value))}
              onDoubleClick={() => setRadiusShift(0)}
              style={{ flex: 1 }}
            />
          </label>
          <button
            style={chip(!!focusOffsets)}
            disabled={!curve}
            title="auto-focus: the layer bends buccal/lingual to follow the sharpest anatomy (teeth) — click again to go back to the flat drawn layer"
            onClick={runAutoFocus}
          >
            auto-focus{focusOffsets ? ' ✓' : ''}
          </button>
          <button
            style={chip(!!panoVoi)}
            disabled={!panoLayers.length}
            title="one-click pano look: contrast window from the pano's own pixels + light sharpening — click again to undo"
            onClick={runAutoAdjust}
          >
            auto-adjust{panoVoi ? ' ✓' : ''}
          </button>
        </div>
        <div style={sliderRow}>
          <span style={small} title="the vertical crop moved to the handles on the pano's right edge (pano-style)">
            vertical range {Math.round(zFrac[0] * 100)}–{Math.round(zFrac[1] * 100)}% (handles right of the pano)
          </span>
          <button
            style={chip(false)}
            disabled={!entry}
            title="reset the reading position — sections to mid-arch, tilt upright, full vertical range, radius shift 0 (arch, slab, and pane layout untouched)"
            onClick={() => {
              if (curve) setSPos(curve.length / 2);
              setSectionTilt(0);
              setZFrac([0, 1]);
              setRadiusShift(0);
            }}
          >
            reset position
          </button>
          <button
            style={{ ...chip(measureMode), display: 'inline-flex', alignItems: 'center', gap: 5 }}
            title="measure on the pano / cross-sections: drag a line, true mm — right-click a line to delete it"
            onClick={() => setMeasureMode((v) => !v)}
          >
            <Ruler size={13} strokeWidth={2} />
            measure{measureMode ? ' ✓' : ''}
          </button>
          <button
            style={chip(false)}
            disabled={!measures.length}
            title="delete every pano/section measurement on this volume"
            onClick={() => setMeasures([])}
          >
            clear ({measures.length})
          </button>
        </div>
        {/* draggable divider: pano ↔ cross-sections. The pointer sits on the divider; the
            control rows between the two flex areas are fixed-height, so the new pano share
            comes from how far the pointer moved the divider (self-correcting per event). */}
        <DragDivider
          cursor="row-resize"
          title="drag to resize the pano vs the cross-sections · double-click resets"
          style={{ height: 6, borderRadius: 3 }}
          onMove={(_x, clientY) => {
            const p = panoAreaRef.current?.getBoundingClientRect();
            const s = sectionsAreaRef.current?.getBoundingClientRect();
            if (!p || !s) return;
            const flexTotal = p.height + s.height;
            if (flexTotal < 60) return;
            const dividerCenter = s.top - 4 - 3; // column gap above the sections + half the divider
            const next = (p.height + (clientY - dividerCenter)) / flexTotal;
            setPanoFrac(Math.min(0.85, Math.max(0.15, next)));
          }}
          onReset={() => setPanoFrac(0.5)}
        />
        <div
          ref={sectionsAreaRef}
          style={{ position: 'relative', flex: `${1 - panoFrac} 1 0%`, minHeight: 80, display: 'flex', gap: 6 }}
        >
          {Array.from({ length: nSections }, (_, k) => (
            <div
              key={k}
              style={{ position: 'relative', flex: 1, minWidth: 0, background: 'var(--viewport-bg)', borderRadius: 4 }}
            >
              <canvas
                ref={(el) => {
                  sectionCvs.current[k] = el;
                }}
                onPointerDown={onSectionDown(k)}
                onPointerMove={onSectionMove(k)}
                onPointerUp={onSectionUp}
                onContextMenu={onSectionContext(k)}
                title="right-drag = rotate the sections (MPR gesture) · right-click a measurement = delete"
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', cursor: activeTrace ? 'copy' : measureMode ? 'crosshair' : 'default', touchAction: 'none' }}
              />
            </div>
          ))}
          {!curve && (
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
              perpendicular cross-sections appear here after you draw the arch
            </div>
          )}
          {rotChip && (
            <span
              style={{
                position: 'absolute',
                top: 6,
                right: 8,
                fontSize: 12,
                color: 'var(--text)',
                background: 'var(--panel-2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '2px 8px',
                pointerEvents: 'none',
              }}
            >
              {rotChip}
            </span>
          )}
        </div>
        <div style={sliderRow}>
          <label style={{ ...small, display: 'flex', gap: 6, alignItems: 'center' }} title="odd counts only — keeps one section exactly on the position line">
            sections {nSections}
            <input
              type="range"
              min={1}
              max={9}
              step={2}
              value={nSections}
              onChange={(e) => setNSections(Number(e.target.value))}
              onDoubleClick={() => setNSections(5)}
              style={{ width: 70 }}
            />
          </label>
          <span style={small} title="right-drag on any section rotates the whole fan in-plane (MPR gesture)">
            tilt {sectionTilt >= 0 ? '+' : ''}{sectionTilt.toFixed(0)}°
          </span>
          <button
            style={chip(false)}
            disabled={Math.abs(sectionTilt) <= 0.01}
            title={
              Math.abs(sectionTilt) > 0.01
                ? 'back upright (0°) — the axial line, canal crossings, and measuring return'
                : 'already upright — right-drag a section to tilt the fan'
            }
            onClick={() => setSectionTilt(0)}
          >
            upright
          </button>
          {/* canonical section-row order (unified 2026-08-05): count → tilt → spacing →
              width → thickness → trailing toggle. Same anatomy in TMJ and Reslice. */}
          <label style={{ ...small, flex: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
            spacing {sectionSpacing} mm
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={sectionSpacing}
              onChange={(e) => setSectionSpacing(Number(e.target.value))}
              onDoubleClick={() => setSectionSpacing(3)}
              style={{ flex: 1 }}
            />
          </label>
          <label style={{ ...small, flex: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
            width {sectionWidth} mm
            <input
              type="range"
              min={10}
              max={50}
              step={2}
              value={sectionWidth}
              onChange={(e) => setSectionWidth(Number(e.target.value))}
              onDoubleClick={() => setSectionWidth(24)}
              style={{ flex: 1 }}
            />
          </label>
          <label style={{ ...small, flex: 1, display: 'flex', gap: 6, alignItems: 'center' }} title="average this many mm ALONG the arch into each section — a thicker, quieter cut">
            thickness {sectionThickness.toFixed(1)} mm
            <input
              type="range"
              min={0}
              max={10}
              step={0.5}
              value={sectionThickness}
              onChange={(e) => setSectionThickness(Number(e.target.value))}
              onDoubleClick={() => setSectionThickness(0.5)}
              style={{ flex: 1 }}
            />
          </label>
          <label style={{ ...small, display: 'flex', gap: 4, alignItems: 'center' }} title="flip which side of the arch faces left in every section (view from the other side)">
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> mirror
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
