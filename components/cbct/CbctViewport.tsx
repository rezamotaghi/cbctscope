'use client';
// CBCT volume viewer core — sibling of DicomViewport (2D untouched). One RenderingEngine,
// 2×2: AXIAL/SAGITTAL/CORONAL MPR + 3D render. Voxels arrive as ONE normalized Int16 HU
// buffer from /api/cbct (browser never parses DICOM here).
//
// The engine OUTLIVES volume switches — a volume pair
// toggle swaps the volume in place, PRESERVING camera/slice/window (same acquisition ⇒ same
// geometry) and prefetching the partner so the toggle is instant. Adds: double-click pane
// maximize, patient-orientation markers computed from the live camera (correct under oblique
// rotation), per-pane slab thickness, a measurement list with delete + store purge between
// volumes, and a scale overlay. Data stays 16-bit end-to-end (no Float32 doubling).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  RenderingEngine,
  Enums,
  volumeLoader,
  setVolumesForViewports,
  cache as csCache,
  eventTarget,
  utilities as csUtils,
  type Types,
} from '@cornerstonejs/core';
import {
  addTool,
  ToolGroupManager,
  annotation as csAnnotation,
  CrosshairsTool,
  TrackballRotateTool,
  PanTool,
  ZoomTool,
  LengthTool,
  AngleTool,
  ArrowAnnotateTool,
  LabelTool,
  RectangleROITool,
  EllipticalROITool,
  PlanarFreehandROITool,
  StackScrollTool,
  ScaleOverlayTool,
  Enums as csToolsEnums,
  utilities as csToolsUtils,
} from '@cornerstonejs/tools';
import { ensureCornerstoneInit } from './cornerstoneInit';
import {
  loadVolumeData,
  keepOnly,
  clearVolumeCache,
  reinsert,
  type CbctMeta,
  type VolumeEntry,
} from './volumeData';
import { apply3dRender, applyProjection, type Render3dSettings } from './render3d';
import { applyClipping, boundsInfo, PlaneIndicators, VTK_KIT, type Crop3d, type Cut } from './scene3d';
import { Eraser3d, type ZRange } from './eraser3d';
import { computeRoi3dStats, Roi3dOutlines, type Roi3d } from './evidence3d';
import {
  composeSnapshot,
  fetchEvidence,
  putEvidence,
  serializeAnnotations,
  EVIDENCE_SCHEMA,
  type SavedCam,
  type SavedView,
  type SnapPane,
} from './evidence';

export type { Crop3d } from './scene3d';

export type { CbctMeta } from './volumeData';

const { MouseBindings } = csToolsEnums;

export type CbctToolMode =
  | 'crosshairs'
  | 'pan'
  | 'length'
  | 'angle'
  | 'arrow'
  | 'text'
  | 'rect'
  | 'ellipse'
  | 'freehand'
  | 'roi3d';
export type MprPane = 'axial' | 'sagittal' | 'coronal';

export interface CbctControls {
  toolMode: CbctToolMode;
  /** Depth (mm) of a 3D box ROI along the drawn pane's view normal. */
  roi3dDepth: number;
  voi: { center: number; width: number } | null;
  invert: boolean;
  slabByPane: Record<MprPane, number>; // mm per MPR pane (0.1 ≈ single slice)
  mip: boolean;
  render3d: Render3dSettings;
  /** Crop box for the 3D render ONLY (slices unaffected) — per-axis kept fractions. */
  crop3d: Crop3d;
  /** Section-plane markers + bounding box drawn inside the 3D render. */
  planes3d: boolean;
  /** Bump to drop every cutaway cut (⇧right-drag on the 3D pane). */
  clearCutsNonce: number;
  /** Plane (crosshair reference) lines on all three MPR views, synced. */
  planeLines: boolean;
  /** Master switch for every overlay: plane lines, measurements, scale bar, orientation letters. */
  showOverlay: boolean;
  /** Display gamma for the slice views (1 = linear). Applied via the slice actors' transfer function. */
  gamma: number;
  resetNonce: number; // orientation only — cameras back to orthogonal, window untouched
  fullResetNonce: number; // cameras + window
}

export interface HistogramData {
  bins: number[];
  minHu: number;
  maxHu: number;
}

// Subsampled HU histogram for the adjust-levels panel (stride keeps it a few ms per volume).
// Exported for CbctRadiograph, which feeds the same panel from its 2D frame.
export function computeHistogram(scalar: Int16Array): HistogramData {
  const N_BINS = 128;
  const stride = Math.max(1, Math.floor(scalar.length / 2_000_000));
  let min = 32767;
  let max = -32768;
  for (let i = 0; i < scalar.length; i += stride) {
    const v = scalar[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max <= min) max = min + 1;
  const bins = new Array<number>(N_BINS).fill(0);
  const scale = N_BINS / (max - min + 1);
  for (let i = 0; i < scalar.length; i += stride) {
    bins[Math.floor((scalar[i] - min) * scale)]++;
  }
  return { bins, minHu: min, maxHu: max };
}

interface Props {
  anon: string;
  controls: CbctControls;
  onMeta?: (meta: CbctMeta) => void;
  onHistogram?: (h: HistogramData) => void;
  onError?: (msg: string) => void;
  /** Restoring a saved view patches the read-state controls the App owns. */
  onControlsPatch?: (patch: Partial<CbctControls>) => void;
}

const VP: Record<MprPane | 'v3d', string> = {
  axial: 'cbct-axial',
  sagittal: 'cbct-sagittal',
  coronal: 'cbct-coronal',
  v3d: 'cbct-3d',
};
const MPR_PANES: MprPane[] = ['axial', 'sagittal', 'coronal'];

// Slice-slider anatomy (verified against the crosshair reference lines, 2026-07-09):
// Cornerstone's index order runs superior→inferior on AXIAL, so that slider is FLIPPED to keep
// drag-up = toward the skull (radiology convention). Sagittal/coronal keep index order
// (up = patient L / up = anterior); the tooltip states each pane's direction.
const SLIDER_FLIP: Record<string, boolean> = { [VP.axial]: true };
const SLIDER_TIP: Record<string, string> = {
  [VP.axial]: 'slice position · up = superior (S)',
  [VP.sagittal]: 'slice position · up = patient left (L)',
  [VP.coronal]: 'slice position · up = anterior (A)',
};
function sliceValue(id: string, info: { idx: number; n: number }): number {
  return SLIDER_FLIP[id] ? info.n - 1 - info.idx : info.idx;
}
function sliceIndexFor(id: string, sliderValue: number, n: number): number {
  return SLIDER_FLIP[id] ? n - 1 - sliderValue : sliderValue;
}
const MPR_IDS = MPR_PANES.map((p) => VP[p]);

// resetCamera() alone re-fits zoom/pan but KEEPS the current view-plane orientation — after an
// oblique/volume rotation the pane would stay rotated. Orientation must be re-set explicitly.
const PANE_AXIS: Record<string, Enums.OrientationAxis> = {
  [VP.axial]: Enums.OrientationAxis.AXIAL,
  [VP.sagittal]: Enums.OrientationAxis.SAGITTAL,
  [VP.coronal]: Enums.OrientationAxis.CORONAL,
};
function resetPaneCameras(engine: RenderingEngine) {
  for (const id of [...MPR_IDS, VP.v3d]) {
    try {
      const vp = engine.getViewport(id) as Types.IVolumeViewport;
      if (PANE_AXIS[id]) {
        (vp as unknown as { setOrientation?: (o: Enums.OrientationAxis) => void }).setOrientation?.(
          PANE_AXIS[id],
        );
      }
      vp.resetCamera();
    } catch {
      /* pane mid-init */
    }
  }
}

const REFLINE_COLORS: Record<string, string> = {
  [VP.axial]: 'rgb(220, 60, 60)',
  [VP.sagittal]: 'rgb(225, 200, 50)',
  [VP.coronal]: 'rgb(70, 200, 90)',
};
// same colors as 0..1 RGB for the vtk plane-indicator quads in the 3D render
const REFLINE_RGB: Record<string, [number, number, number]> = {
  [VP.axial]: [0.86, 0.24, 0.24],
  [VP.sagittal]: [0.88, 0.78, 0.2],
  [VP.coronal]: [0.27, 0.78, 0.35],
};

function ensureLocalVolume(anon: string, entry: VolumeEntry): string {
  const volumeId = `cbctlocal:${anon}`;
  if (csCache.getVolume(volumeId)) return volumeId;
  const { meta, scalar } = entry;
  const create = () => volumeLoader.createLocalVolume(volumeId, buildLocalVolumeOptions(anon, meta, scalar));
  try {
    create();
  } catch {
    // createLocalVolume also caches derived per-slice images which removeVolumeLoadObject does
    // NOT clean up — recreating an evicted volume then throws "imageId already in cache".
    // The CBCT screen owns its Cornerstone world, so a full purge + one retry is safe.
    csCache.purgeCache();
    reinsert(anon, entry); // purge doesn't touch our fetch cache, but keep it coherent anyway
    create();
  }
  return volumeId;
}

function buildLocalVolumeOptions(anon: string, meta: CbctMeta, scalar: Int16Array) {
  const [cols, rows, slices] = meta.dims;
  return {
    dimensions: [cols, rows, slices] as Types.Point3,
    spacing: meta.spacing as Types.Point3,
    origin: meta.origin as Types.Point3,
    direction: [1, 0, 0, 0, 1, 0, 0, 0, 1] as Types.Mat3,
    scalarData: scalar,
    metadata: {
      BitsAllocated: 16,
      BitsStored: 16,
      HighBit: 15,
      SamplesPerPixel: 1,
      PhotometricInterpretation: 'MONOCHROME2',
      PixelRepresentation: 1,
      Modality: 'CT',
      ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
      PixelSpacing: [meta.spacing[0], meta.spacing[1]],
      FrameOfReferenceUID: `cbctscope.${anon}`,
      Columns: cols,
      Rows: rows,
      voiLut: [],
    } as unknown as Types.Metadata,
  };
}

// ---- patient-orientation markers (LPS: +x=L, +y=P, +z=S), from the LIVE camera so they
// stay honest under crosshair/oblique rotation. right = viewUp × viewPlaneNormal.
function axisLabel(v: [number, number, number]): string {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  if (ax >= ay && ax >= az) return v[0] >= 0 ? 'L' : 'R';
  if (ay >= ax && ay >= az) return v[1] >= 0 ? 'P' : 'A';
  return v[2] >= 0 ? 'S' : 'I';
}
function cross(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
interface Markers { right: string; left: string; top: string; bottom: string }
function markersFromCamera(cam: Types.ICamera): Markers | null {
  if (!cam.viewUp || !cam.viewPlaneNormal) return null;
  const r = cross(cam.viewUp as number[], cam.viewPlaneNormal as number[]);
  const t = cam.viewUp as number[];
  const neg = (v: number[]) => [-v[0], -v[1], -v[2]] as [number, number, number];
  return {
    right: axisLabel(r as [number, number, number]),
    left: axisLabel(neg(r)),
    top: axisLabel(t as [number, number, number]),
    bottom: axisLabel(neg(t)),
  };
}

interface VtkVolumeProperty {
  getRGBTransferFunction: (i: number) => {
    removeAllPoints: () => void;
    addRGBPoint: (v: number, r: number, g: number, b: number) => void;
  };
  getScalarOpacity: (i: number) => {
    removeAllPoints: () => void;
    addPoint: (v: number, o: number) => void;
  };
  setShade: (v: boolean) => void;
  setAmbient: (v: number) => void;
  setDiffuse: (v: number) => void;
  setSpecular: (v: number) => void;
  setSpecularPower: (v: number) => void;
}

// Gamma for the slice views: rewrite each MPR actor's grayscale transfer function as a
// gamma curve between the VOI cut points (vtk clamps outside the range). gamma===1 uses the
// stock linear path (applyVoi) untouched.
function applyMprGamma(
  engine: RenderingEngine,
  voi: { center: number; width: number },
  invert: boolean,
  gamma: number,
) {
  const lower = voi.center - voi.width / 2;
  const upper = voi.center + voi.width / 2;
  for (const id of MPR_IDS) {
    try {
      const vp = engine.getViewport(id) as Types.IVolumeViewport;
      const prop = (
        vp.getDefaultActor()?.actor as unknown as { getProperty?: () => VtkVolumeProperty }
      )?.getProperty?.();
      if (!prop) continue;
      const ctf = prop.getRGBTransferFunction(0);
      ctf.removeAllPoints();
      const STEPS = 24;
      for (let i = 0; i <= STEPS; i++) {
        const f = i / STEPS;
        let y = Math.pow(f, 1 / Math.max(0.05, gamma));
        if (invert) y = 1 - y;
        ctf.addRGBPoint(lower + f * (upper - lower), y, y, y);
      }
      vp.render();
    } catch {
      /* pane mid-init */
    }
  }
}

function normalizeV(v: number[]): number[] {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

/** Rodrigues rotation of v around unit axis by deg. */
function rotateVec(v: number[], axis: number[], deg: number): number[] {
  const th = (deg * Math.PI) / 180;
  const [x, y, z] = v;
  const [ux, uy, uz] = axis;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const d = (1 - c) * (ux * x + uy * y + uz * z);
  return [
    x * c + (uy * z - uz * y) * sn + ux * d,
    y * c + (uz * x - ux * z) * sn + uy * d,
    z * c + (ux * y - uy * x) * sn + uz * d,
  ];
}

interface MeasureRow { uid: string; label: string; world: number[] | null; visible: boolean }

let cbctToolsAdded = false;
function ensureCbctTools() {
  if (cbctToolsAdded) return;
  try {
    addTool(CrosshairsTool);
    addTool(TrackballRotateTool);
    addTool(ScaleOverlayTool);
    addTool(ArrowAnnotateTool);
    addTool(LabelTool);
    addTool(RectangleROITool);
    addTool(EllipticalROITool);
    addTool(PlanarFreehandROITool);
  } catch {
    /* already registered (hot reload) */
  }
  cbctToolsAdded = true;
}

// roi3d is OURS, not a Cornerstone tool (null): no primary tool is activated in that mode, so
// the left button falls through to the custom drag-a-box handlers below.
const TOOL_OF: Record<CbctToolMode, string | null> = {
  crosshairs: CrosshairsTool.toolName,
  pan: PanTool.toolName,
  length: LengthTool.toolName,
  angle: AngleTool.toolName,
  arrow: ArrowAnnotateTool.toolName,
  text: LabelTool.toolName,
  rect: RectangleROITool.toolName,
  ellipse: EllipticalROITool.toolName,
  freehand: PlanarFreehandROITool.toolName,
  roi3d: null,
};

// Every evidence annotation the object list manages (crosshair + scale-bar annotations are
// tool plumbing, not evidence — they stay out of the list, the purge, and the sidecar).
const MEASURE_TOOLS = new Set<string>([
  LengthTool.toolName,
  AngleTool.toolName,
  ArrowAnnotateTool.toolName,
  LabelTool.toolName,
  RectangleROITool.toolName,
  EllipticalROITool.toolName,
  PlanarFreehandROITool.toolName,
]);

// One-line object-browser label per annotation: kind glyph + the value that matters
// (mm / ° / HU stats / the typed text).
function annotationLabel(a: {
  metadata?: { toolName?: string };
  data?: {
    label?: string;
    text?: string;
    cachedStats?: Record<string, { length?: number; angle?: number; area?: number; mean?: number; stdDev?: number }>;
    contour?: { polyline?: number[][]; closed?: boolean };
    handles?: { points?: number[][] };
  };
}): string {
  const tn = a.metadata?.toolName;
  const stats = Object.values(a.data?.cachedStats ?? {})[0];
  const txt = (a.data?.label || a.data?.text || '').trim();
  switch (tn) {
    case LengthTool.toolName:
      return stats?.length != null ? `↔ ${stats.length.toFixed(1)} mm` : '↔ …';
    case AngleTool.toolName:
      return stats?.angle != null ? `∠ ${stats.angle.toFixed(1)}°` : '∠ …';
    case ArrowAnnotateTool.toolName:
      return `➤ ${txt || 'arrow'}`;
    case LabelTool.toolName:
      return `T ${txt || 'text'}`;
    case RectangleROITool.toolName:
    case EllipticalROITool.toolName: {
      const glyph = tn === RectangleROITool.toolName ? '▭' : '⬭';
      if (stats?.mean == null) return `${glyph} …`;
      const sd = stats.stdDev != null ? `±${Math.round(stats.stdDev)}` : '';
      const area = stats.area != null ? ` · ${stats.area.toFixed(0)} mm²` : '';
      return `${glyph} ${Math.round(stats.mean)}${sd} HU${area}`;
    }
    case PlanarFreehandROITool.toolName: {
      const poly = a.data?.contour?.polyline;
      if (a.data?.contour?.closed) {
        if (stats?.mean != null) {
          const area = stats.area != null ? ` · ${stats.area.toFixed(0)} mm²` : '';
          return `⬯ ${Math.round(stats.mean)}±${Math.round(stats.stdDev ?? 0)} HU${area}`;
        }
        return '⬯ region';
      }
      if (poly && poly.length > 1) {
        let len = 0;
        for (let i = 1; i < poly.length; i++) {
          len += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1], poly[i][2] - poly[i - 1][2]);
        }
        return `〰 ${len.toFixed(1)} mm`;
      }
      return '〰 …';
    }
    default:
      return tn ?? '?';
  }
}

/** A representative world point for click-to-jump (first handle, else first contour vertex). */
function annotationWorld(a: {
  data?: { handles?: { points?: number[][] }; contour?: { polyline?: number[][] } };
}): number[] | null {
  return a.data?.handles?.points?.[0] ?? a.data?.contour?.polyline?.[0] ?? null;
}

// The crosshairs tool's per-viewport line annotations can be lost for good after a
// disable/enable cycle mixed with camera/orientation changes (observed: lines left on one
// pane only). Purging its annotations and re-activating forces a clean rebuild on all
// three panes; if the reader's primary tool isn't crosshairs, the lines stay (passive)
// and the real tool gets the mouse back.
function reinitCrosshairs(toolMode: CbctToolMode) {
  const mpr = ToolGroupManager.getToolGroup('tg-cbct-mpr');
  if (!mpr) return;
  try {
    for (const a of csAnnotation.state.getAllAnnotations()) {
      if (a.metadata?.toolName === CrosshairsTool.toolName) {
        csAnnotation.state.removeAnnotation(a.annotationUID!);
      }
    }
    mpr.setToolDisabled(CrosshairsTool.toolName);
    mpr.setToolActive(CrosshairsTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
    if (toolMode !== 'crosshairs') {
      // ENABLED, not passive: a passive crosshairs still grabs any drag near its full-pane
      // reference lines and steals the stroke from the annotation tool (the arrow-tool bug).
      // Enabled = lines render, mouse never intercepted.
      mpr.setToolEnabled(CrosshairsTool.toolName);
      const t = TOOL_OF[toolMode];
      if (t) mpr.setToolActive(t, { bindings: [{ mouseButton: MouseBindings.Primary }] });
    }
  } catch (e) {
    console.warn('crosshairs reinit failed', e);
  }
}

function purgeMeasurements() {
  try {
    const all = csAnnotation.state.getAllAnnotations();
    for (const a of all) {
      if (MEASURE_TOOLS.has(a.metadata?.toolName ?? '')) {
        csAnnotation.state.removeAnnotation(a.annotationUID!);
      }
    }
  } catch {
    /* store empty */
  }
}

let engineSeq = 0;

export default function CbctViewport({
  anon,
  controls,
  onMeta,
  onHistogram,
  onError,
  onControlsPatch,
}: Props) {
  const elRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const gridRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RenderingEngine | null>(null);
  const engineIdRef = useRef('');
  const metaRef = useRef<CbctMeta | null>(null);
  const scalarRef = useRef<Int16Array | null>(null); // voxel HU buffer — cursor readout samples it directly
  const huRefs = useRef<Record<string, HTMLSpanElement | null>>({}); // HU chips update imperatively (60 Hz, no re-render)
  const prevAnonRef = useRef<string | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [sliceInfo, setSliceInfo] = useState<Record<string, { idx: number; n: number }>>({});
  const sliceInfoRef = useRef<Record<string, { idx: number; n: number }>>({});
  sliceInfoRef.current = sliceInfo;
  const [markers, setMarkers] = useState<Record<string, Markers>>({});
  const [measures, setMeasures] = useState<MeasureRow[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const selectedUidRef = useRef<string | null>(null);
  selectedUidRef.current = selectedUid;
  // schedule-a-sidecar-save hook — wired up by the persistence effect below; the annotation
  // event listeners in the mount effect call through this ref.
  const evidenceDirtyRef = useRef<() => void>(() => {});
  // rebuild the object-browser rows on demand (evidence load adds annotations without firing
  // the COMPLETED/MODIFIED events the mount listener watches)
  const refreshMeasuresRef = useRef<() => void>(() => {});
  const [maximized, setMaximized] = useState<string | null>(null);
  const maximizedRef = useRef<string | null>(null);
  maximizedRef.current = maximized;
  // Which pane's slice slider is being dragged — shows the slice readout chip next to the thumb.
  const [dragSlice, setDragSlice] = useState<string | null>(null);
  // Live right-drag oblique rotation: which pane is rotating + degrees swept (readout chip).
  const [rotDrag, setRotDrag] = useState<{ id: string; deg: number } | null>(null);
  const [ready, setReady] = useState(false);
  // Cutaway (⇧right-drag on the 3D pane): accumulated cuts + live-drag readout.
  const cutsRef = useRef<Cut[]>([]);
  const [cutCount, setCutCount] = useState(0);
  const [cutDrag, setCutDrag] = useState<number | null>(null); // live depth in mm
  // Plane indicators inside the 3D render (created lazily once the renderer exists).
  const indicatorsRef = useRef<PlaneIndicators | null>(null);
  const cropRef = useRef<Crop3d>(controls.crop3d);
  cropRef.current = controls.crop3d;
  const r3dRef = useRef<Render3dSettings>(controls.render3d);
  r3dRef.current = controls.render3d;

  // ---- 3D box ROI (roi3d tool mode): drag a rectangle on any slice pane → an oriented box
  // of voxels (rectangle × configurable depth) characterized with HU stats; outline in 3D.
  const [rois3d, setRois3d] = useState<Roi3d[]>([]);
  const rois3dRef = useRef<Roi3d[]>([]);
  rois3dRef.current = rois3d;
  const roiOutlinesRef = useRef<Roi3dOutlines | null>(null);
  const roiSeqRef = useRef(0);
  const [roiDrag, setRoiDrag] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const toolModeRef = useRef(controls.toolMode);
  toolModeRef.current = controls.toolMode;
  const roiDepthRef = useRef(controls.roi3dDepth);
  roiDepthRef.current = controls.roi3dDepth;

  // Rectangle done → oriented world box (axes from the pane's live camera, so it is correct
  // on rotated sections too) → stats from the voxel buffer.
  const finalizeRoi = (id: string, a: [number, number], b: [number, number]) => {
    const engine = engineRef.current;
    const meta = metaRef.current;
    const scalar = scalarRef.current;
    if (!engine || !meta || !scalar) return;
    try {
      const vp = engine.getViewport(id) as Types.IVolumeViewport;
      const wA = vp.canvasToWorld(a) as number[];
      const wB = vp.canvasToWorld(b) as number[];
      const cam = vp.getCamera();
      if (!cam.viewPlaneNormal || !cam.viewUp) return;
      const n = normalizeV(cam.viewPlaneNormal as number[]);
      const v = normalizeV(cam.viewUp as number[]);
      const u = normalizeV(cross(v, n));
      const d = [wB[0] - wA[0], wB[1] - wA[1], wB[2] - wA[2]];
      const half: [number, number, number] = [
        Math.abs(d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / 2,
        Math.abs(d[0] * v[0] + d[1] * v[1] + d[2] * v[2]) / 2,
        Math.max(0.5, roiDepthRef.current / 2),
      ];
      const center: [number, number, number] = [
        (wA[0] + wB[0]) / 2,
        (wA[1] + wB[1]) / 2,
        (wA[2] + wB[2]) / 2,
      ];
      const axes: [number[], number[], number[]] = [u, v, n];
      const stats = computeRoi3dStats(
        scalar,
        { dims: meta.dims, spacing: meta.spacing, origin: meta.origin },
        center,
        axes,
        half,
      );
      if (!stats) return;
      const roi: Roi3d = {
        id: `roi${++roiSeqRef.current}-${Date.now().toString(36)}`,
        center,
        axes,
        half,
        stats,
        visible: true,
      };
      setRois3d((r) => [...r, roi]);
      setSelectedUid(`roi3d:${roi.id}`);
    } catch (e) {
      console.warn('roi3d finalize failed', e);
    }
  };
  const finalizeRoiRef = useRef(finalizeRoi);
  finalizeRoiRef.current = finalizeRoi;

  // ---- saved views (V): all four pane cameras + the read-state controls, named — one click
  // returns to a finding's exact presentation. Restoring patches the App's controls and then
  // re-applies the cameras (twice: the render-settings effects can re-fit the 3D camera).
  const [views, setViews] = useState<SavedView[]>([]);
  const viewsRef = useRef<SavedView[]>([]);
  viewsRef.current = views;
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const saveView = () => {
    const engine = engineRef.current;
    if (!engine || !metaRef.current) return;
    const name = window.prompt('Name this view:', `view ${viewsRef.current.length + 1}`)?.trim();
    if (!name) return;
    const cameras: Record<string, SavedCam> = {};
    for (const id of [...MPR_IDS, VP.v3d]) {
      try {
        const cam = engine.getViewport(id).getCamera();
        cameras[id] = {
          position: [...(cam.position as number[])],
          focalPoint: [...(cam.focalPoint as number[])],
          viewUp: [...(cam.viewUp as number[])],
          parallelScale: cam.parallelScale,
        };
      } catch {
        /* pane mid-init */
      }
    }
    const c = controlsRef.current;
    const patch: Partial<CbctControls> = {
      voi: c.voi ? { ...c.voi } : null,
      invert: c.invert,
      gamma: c.gamma,
      slabByPane: { ...c.slabByPane },
      mip: c.mip,
      render3d: { ...c.render3d },
      crop3d: { x: [...c.crop3d.x], y: [...c.crop3d.y], z: [...c.crop3d.z] },
      planes3d: c.planes3d,
    };
    setViews((v) => [...v, { id: `view-${Date.now().toString(36)}`, name, cameras, patch }]);
  };
  const saveViewRef = useRef(saveView);
  saveViewRef.current = saveView;

  const applySavedCams = (v: SavedView) => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const [id, cam] of Object.entries(v.cameras)) {
      try {
        const vp = engine.getViewport(id);
        vp.setCamera({
          position: [...cam.position] as Types.Point3,
          focalPoint: [...cam.focalPoint] as Types.Point3,
          viewUp: [...cam.viewUp] as Types.Point3,
          ...(cam.parallelScale ? { parallelScale: cam.parallelScale } : {}),
        });
        vp.render();
      } catch {
        /* pane mid-init */
      }
    }
    renderAnnotationsNowRef.current();
    updateIndicatorsRef.current();
  };
  const restoreView = (v: SavedView) => {
    onControlsPatch?.(v.patch);
    applySavedCams(v);
    // the render-settings/projection effects the patch triggers can re-fit the 3D camera —
    // re-apply once they have settled
    setTimeout(() => applySavedCams(v), 250);
  };

  // ---- snapshots: the visible layout (maximized pane, else all four) → one PNG download,
  // annotation SVG layers included; labels + case/timestamp footer for report figures.
  const takeSnapshot = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const ids = maximizedRef.current ? [maximizedRef.current] : [VP.axial, VP.sagittal, VP.coronal, VP.v3d];
    try {
      engine.renderViewports(ids);
    } catch {
      /* mid-init */
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const panes: SnapPane[] = [];
    for (const id of ids) {
      const el = elRefs.current[id];
      const canvas = el?.querySelector('canvas');
      if (!canvas) continue;
      const svg = controlsRef.current.showOverlay ? (el?.querySelector('svg') as SVGSVGElement | null) : null;
      const base = id === VP.v3d ? '3D' : id.replace('cbct-', '').toUpperCase();
      const info = sliceInfoRef.current[id];
      panes.push({ canvas, svg, label: info ? `${base} ${info.idx + 1}/${info.n}` : base });
    }
    const url = await composeSnapshot(panes, `${anon} · ${new Date().toLocaleString()}`);
    if (!url) return;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${anon}-snap-${ts}.png`;
    a.click();
  };

  // ---- evidence sidecar: everything above (annotations + views + 3D ROIs) auto-saves per
  // volume, debounced; loaded back right after the volume attaches. The ready flag keeps the
  // purge-on-volume-switch from writing an empty file over the previous volume's evidence.
  const evidenceReadyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** sidecar fields THIS view doesn't manage (e.g. the pano's nerve traces) — carried through saves */
  const foreignEvidenceRef = useRef<Record<string, unknown>>({});
  const writeEvidence = async () => {
    try {
      const annos = csAnnotation.state
        .getAllAnnotations()
        .filter((a) => MEASURE_TOOLS.has(a.metadata?.toolName ?? ''));
      await putEvidence({
        ...foreignEvidenceRef.current, // fields owned by other views (pano traces) — never clobber
        schema: EVIDENCE_SCHEMA,
        anon,
        saved_at: new Date().toISOString(),
        annotations: serializeAnnotations(annos as unknown[]),
        views: viewsRef.current,
        rois3d: rois3dRef.current,
      });
    } catch (e) {
      console.warn('evidence save failed', e);
    }
  };
  const writeEvidenceRef = useRef(writeEvidence);
  writeEvidenceRef.current = writeEvidence;
  const scheduleEvidenceSave = () => {
    if (!evidenceReadyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void writeEvidenceRef.current();
    }, 800);
  };
  evidenceDirtyRef.current = scheduleEvidenceSave;

  // views changed ⇒ persist (rois3d + annotations schedule from their own paths)
  useEffect(() => {
    evidenceDirtyRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views]);

  // ---- clean-rendering eraser. SAFETY: the eraser never edits the buffer the MPR slices
  // read — the 3D pane switches to its own COPY of the voxels first (see ensureEraseVolume).
  const [eraseMode, setEraseMode] = useState(false);
  const [eraseRadius, setEraseRadius] = useState(4); // mm
  const [eraseInfo, setEraseInfo] = useState({ undo: 0, redo: 0 });
  const eraseModeRef = useRef(false);
  eraseModeRef.current = eraseMode;
  const eraseRadiusRef = useRef(4);
  eraseRadiusRef.current = eraseRadius;
  const eraserRef = useRef<Eraser3d | null>(null);
  const eraseVolIdRef = useRef<string | null>(null);
  const lastUploadRef = useRef(0);

  const syncEraseInfo = () => {
    const er = eraserRef.current;
    setEraseInfo({ undo: er?.strokeCount() ?? 0, redo: er?.canRedo() ? 1 : 0 });
  };
  const syncEraseInfoRef = useRef(syncEraseInfo);
  syncEraseInfoRef.current = syncEraseInfo;

  // Push edited frames to the GPU. Cornerstone streams the volume texture PER FRAME
  // (z-slice), so only the touched range re-uploads — throttled during a stroke, forced at
  // stroke end / undo / redo. Pending ranges merge across throttled samples.
  const pendingZRef = useRef<ZRange | null>(null);
  const refreshEraseTexture = (force: boolean, zRange: ZRange | null) => {
    if (zRange) {
      const p = pendingZRef.current;
      pendingZRef.current = p ? [Math.min(p[0], zRange[0]), Math.max(p[1], zRange[1])] : zRange;
    }
    const now = performance.now();
    if (!force && now - lastUploadRef.current < 200) return;
    const pending = pendingZRef.current;
    if (!pending) return;
    pendingZRef.current = null;
    lastUploadRef.current = now;
    const id = eraseVolIdRef.current;
    if (!id || !engineRef.current) return;
    try {
      const vol = csCache.getVolume(id) as unknown as {
        vtkOpenGLTexture?: { setUpdatedFrame: (i: number) => void };
        imageData?: { modified: () => void };
      };
      for (let f = pending[0]; f <= pending[1]; f++) vol?.vtkOpenGLTexture?.setUpdatedFrame(f);
      vol?.imageData?.modified();
      engineRef.current.getViewport(VP.v3d).render();
    } catch {
      /* volume mid-swap */
    }
  };
  const refreshEraseTextureRef = useRef(refreshEraseTexture);
  refreshEraseTextureRef.current = refreshEraseTexture;

  // Give the 3D pane its own voxel copy and point the eraser at it. Camera is preserved.
  const ensureEraseVolume = async () => {
    if (eraserRef.current || !engineRef.current || !metaRef.current || !scalarRef.current) return;
    const meta = metaRef.current;
    const copy = new Int16Array(scalarRef.current); // the ONLY buffer the eraser edits
    const id = `cbctlocal:${anon}:erase`;
    try {
      if (!csCache.getVolume(id)) {
        volumeLoader.createLocalVolume(id, buildLocalVolumeOptions(`${anon}-erase`, meta, copy));
      }
      const vp = engineRef.current.getViewport(VP.v3d);
      const cam = vp.getCamera();
      await setVolumesForViewports(engineRef.current, [{ volumeId: id }], [VP.v3d]);
      vp.setCamera(cam);
      eraseVolIdRef.current = id;
      // Cornerstone 4 volumes stream the GPU texture from PER-SLICE images (the vtkImageData
      // holds no CPU scalar array) — the voxelManager is the one write path guaranteed to hit
      // the buffers those frames upload from.
      const vol = csCache.getVolume(id) as unknown as {
        voxelManager?: { getAtIndex: (i: number) => number; setAtIndex: (i: number, v: number) => void };
      };
      const vm = vol?.voxelManager;
      if (!vm) throw new Error('erase volume has no voxel manager');
      eraserRef.current = new Eraser3d(
        { get: (i) => vm.getAtIndex(i), set: (i, v) => vm.setAtIndex(i, v) },
        {
          dims: meta.dims,
          spacing: meta.spacing,
          origin: meta.origin,
        },
      );
      // fresh actor ⇒ re-dress it
      apply3dRender(engineRef.current, VP.v3d, r3dRef.current);
      reclipRef.current();
      vp.render();
    } catch (e) {
      console.warn('erase volume setup failed', e);
    }
  };

  // Drop the eraser copy: reattach the ORIGINAL volume to the 3D pane, free the copy.
  const dropEraseVolume = async (rerender: boolean) => {
    const id = eraseVolIdRef.current;
    eraserRef.current = null;
    eraseVolIdRef.current = null;
    setEraseInfo({ undo: 0, redo: 0 });
    if (!id || !engineRef.current) return;
    try {
      if (rerender && csCache.getVolume(`cbctlocal:${anon}`)) {
        const vp = engineRef.current.getViewport(VP.v3d);
        const cam = vp.getCamera();
        await setVolumesForViewports(engineRef.current, [{ volumeId: `cbctlocal:${anon}` }], [VP.v3d]);
        vp.setCamera(cam);
        apply3dRender(engineRef.current, VP.v3d, r3dRef.current);
        reclipRef.current();
        vp.render();
      }
    } catch (e) {
      console.warn('erase volume teardown failed', e);
    }
    try {
      csCache.removeVolumeLoadObject(id);
    } catch {
      /* not cached */
    }
  };

  const reclip = () => {
    if (!engineRef.current) return;
    try {
      applyClipping(engineRef.current, VP.v3d, cropRef.current, cutsRef.current);
    } catch (e) {
      console.warn('clipping failed', e);
    }
  };
  const reclipRef = useRef(reclip);
  reclipRef.current = reclip;

  // The three quads track the MPR cameras — one call gathers all live pane states.
  const updateIndicators = () => {
    const engine = engineRef.current;
    const ind = indicatorsRef.current;
    if (!engine || !ind || !ind.isVisible()) return;
    try {
      const panes = MPR_IDS.map((id) => {
        const cam = engine.getViewport(id).getCamera();
        return {
          color: REFLINE_RGB[id],
          focal: cam.focalPoint as number[],
          normal: cam.viewPlaneNormal as number[],
        };
      });
      ind.update(panes);
      engine.getViewport(VP.v3d).render();
    } catch {
      /* panes mid-init */
    }
  };
  const updateIndicatorsRef = useRef(updateIndicators);
  updateIndicatorsRef.current = updateIndicators;

  // MPR rotation: right-drag rotates the SECTION you're on — the image itself turns
  // clockwise/anticlockwise about the crosshair center, and the other two panes re-slice in
  // sync (all three cameras rotate rigidly about the dragged pane's view normal, so the planes
  // stay mutually orthogonal). The crosshair reference lines re-derive from the cameras.
  const applySectionRotation = (axis: number[], pivot: number[], deg: number) => {
    const engine = engineRef.current;
    if (!engine || !deg) return;
    const rel = (p: number[]) => [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
    const back = (p: number[]) => [p[0] + pivot[0], p[1] + pivot[1], p[2] + pivot[2]];
    for (const id of MPR_IDS) {
      try {
        const vp = engine.getViewport(id) as Types.IVolumeViewport;
        const cam = vp.getCamera();
        vp.setCamera({
          position: back(rotateVec(rel(cam.position as number[]), axis, deg)) as Types.Point3,
          focalPoint: back(rotateVec(rel(cam.focalPoint as number[]), axis, deg)) as Types.Point3,
          viewUp: rotateVec(cam.viewUp as number[], axis, deg) as Types.Point3,
        });
        vp.render();
      } catch {
        /* pane mid-init */
      }
    }
  };
  const applyRotationRef = useRef(applySectionRotation);
  applyRotationRef.current = applySectionRotation;

  // Slice all three MPR panes to pass through a world point (object-browser click-to-jump).
  // Each camera shifts along its own view normal only — zoom/pan/rotation stay put. The
  // crosshair center follows so the reference lines land on the object too.
  const jumpPanesToWorld = (world: number[]) => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const id of MPR_IDS) {
      try {
        const vp = engine.getViewport(id) as Types.IVolumeViewport;
        const cam = vp.getCamera();
        if (!cam.viewPlaneNormal || !cam.focalPoint) continue;
        const n = normalizeV(cam.viewPlaneNormal as number[]);
        const f = cam.focalPoint as number[];
        const d = (world[0] - f[0]) * n[0] + (world[1] - f[1]) * n[1] + (world[2] - f[2]) * n[2];
        const pos = cam.position as number[];
        vp.setCamera({
          focalPoint: [f[0] + n[0] * d, f[1] + n[1] * d, f[2] + n[2] * d] as Types.Point3,
          position: [pos[0] + n[0] * d, pos[1] + n[1] * d, pos[2] + n[2] * d] as Types.Point3,
        });
        vp.render();
      } catch {
        /* pane mid-init */
      }
    }
    try {
      const ch = ToolGroupManager.getToolGroup('tg-cbct-mpr')?.getToolInstance?.(CrosshairsTool.toolName) as
        | { setToolCenter?: (p: Types.Point3) => void }
        | undefined;
      ch?.setToolCenter?.([world[0], world[1], world[2]] as Types.Point3);
    } catch {
      /* lines hidden */
    }
    renderAnnotationsNowRef.current();
  };

  // Del/Backspace: remove the object-browser selection, else whatever Cornerstone has
  // selected (shift-click on an annotation). Returns true if something was deleted.
  const deleteSelected = (): boolean => {
    const sel = selectedUidRef.current;
    if (sel?.startsWith('roi3d:')) {
      const rid = sel.slice(6);
      if (rois3dRef.current.some((r) => r.id === rid)) {
        setRois3d((rs) => rs.filter((r) => r.id !== rid));
        setSelectedUid(null);
        return true;
      }
    }
    let uids: string[] = [];
    if (selectedUidRef.current) uids = [selectedUidRef.current];
    else {
      try {
        uids = (csAnnotation.selection.getAnnotationsSelected() ?? []) as string[];
      } catch {
        uids = [];
      }
    }
    let removed = false;
    for (const uid of uids) {
      try {
        const a = csAnnotation.state.getAnnotation(uid);
        if (!a || !MEASURE_TOOLS.has(a.metadata?.toolName ?? '')) continue;
        csAnnotation.state.removeAnnotation(uid);
        removed = true;
      } catch {
        /* already gone */
      }
    }
    if (removed) {
      setSelectedUid(null);
      engineRef.current?.renderViewports(MPR_IDS);
      renderAnnotationsNowRef.current();
    }
    return removed;
  };
  const deleteSelectedRef = useRef(deleteSelected);
  deleteSelectedRef.current = deleteSelected;

  // ---------- mount ONCE: engine + viewports + tool groups + listeners ----------
  useEffect(() => {
    let disposed = false;
    const engineId = `cbctscope-${++engineSeq}`;
    engineIdRef.current = engineId;

    const paneUpdate = (id: string) => {
      try {
        const vp = engineRef.current?.getViewport(id) as Types.IVolumeViewport | undefined;
        if (!vp) return;
        const idx = (vp as unknown as { getSliceIndex?: () => number }).getSliceIndex?.();
        const n = (vp as unknown as { getNumberOfSlices?: () => number }).getNumberOfSlices?.();
        if (idx != null && n != null && Number.isFinite(idx)) {
          setSliceInfo((s) => ({ ...s, [id]: { idx, n } }));
        }
        const m = markersFromCamera(vp.getCamera());
        if (m) setMarkers((s) => ({ ...s, [id]: m }));
        updateIndicatorsRef.current(); // 3D plane markers follow the MPR cameras
      } catch {
        /* best-effort readouts */
      }
    };

    (async () => {
      await ensureCornerstoneInit();
      ensureCbctTools();
      if (disposed) return;

      const engine = new RenderingEngine(engineId);
      engineRef.current = engine;
      engine.setViewports([
        ...MPR_PANES.map((p) => ({
          viewportId: VP[p],
          element: elRefs.current[VP[p]]!,
          type: Enums.ViewportType.ORTHOGRAPHIC,
          defaultOptions: {
            orientation:
              p === 'axial'
                ? Enums.OrientationAxis.AXIAL
                : p === 'sagittal'
                  ? Enums.OrientationAxis.SAGITTAL
                  : Enums.OrientationAxis.CORONAL,
            background: [0, 0, 0] as Types.Point3,
          },
        })),
        {
          viewportId: VP.v3d,
          element: elRefs.current[VP.v3d]!,
          type: Enums.ViewportType.VOLUME_3D,
          defaultOptions: { background: [0.04, 0.04, 0.06] as Types.Point3 },
        },
      ]);

      ToolGroupManager.destroyToolGroup('tg-cbct-mpr');
      ToolGroupManager.destroyToolGroup('tg-cbct-3d');
      const mpr = ToolGroupManager.createToolGroup('tg-cbct-mpr')!;
      mpr.addTool(CrosshairsTool.toolName, {
        getReferenceLineColor: (id: string) => REFLINE_COLORS[id] ?? 'rgb(150,150,150)',
        getReferenceLineControllable: () => true,
        getReferenceLineDraggableRotatable: () => true,
        getReferenceLineSlabThicknessControlsOn: () => false,
      });
      for (const t of [
        PanTool,
        ZoomTool,
        LengthTool,
        AngleTool,
        ArrowAnnotateTool,
        LabelTool,
        RectangleROITool,
        EllipticalROITool,
        StackScrollTool,
      ])
        mpr.addTool(t.toolName);
      // freehand: open strokes measure a curved path (polyline mm in the object list);
      // closing the loop makes it a region with HU stats like the rect/ellipse ROIs
      mpr.addTool(PlanarFreehandROITool.toolName, { calculateStats: true });
      try {
        mpr.addTool(ScaleOverlayTool.toolName, { scaleLocation: 'bottom' });
      } catch (e) {
        console.warn('scale overlay unavailable', e);
      }
      for (const id of MPR_IDS) mpr.addViewport(id, engineId);
      mpr.setToolActive(StackScrollTool.toolName, { bindings: [{ mouseButton: MouseBindings.Wheel }] });
      // plain right-drag is the oblique rotate (custom handlers below) — zoom
      // keeps a mouse binding on ⇧+right-drag
      mpr.setToolActive(ZoomTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Secondary, modifierKey: csToolsEnums.KeyboardBindings.Shift }],
      });
      mpr.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
      // NOTE: ScaleOverlayTool is enabled only after a volume is attached (see the volume-load
      // effect) — enabling it here makes it render against an empty viewport and throw inside
      // Cornerstone (vec3.distance on undefined).

      const t3d = ToolGroupManager.createToolGroup('tg-cbct-3d')!;
      for (const t of [TrackballRotateTool, ZoomTool, PanTool]) t3d.addTool(t.toolName);
      t3d.addViewport(VP.v3d, engineId);
      t3d.setToolActive(TrackballRotateTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
      t3d.setToolActive(ZoomTool.toolName, { bindings: [{ mouseButton: MouseBindings.Secondary }] });
      t3d.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });

      for (const id of MPR_IDS) {
        elRefs.current[id]?.addEventListener(Enums.Events.CAMERA_MODIFIED, () => paneUpdate(id));
      }
      setReady(true);
    })();

    // object list ← Cornerstone annotation events (all evidence tools)
    const refreshMeasures = () => {
      try {
        const rows: MeasureRow[] = [];
        for (const a of csAnnotation.state.getAllAnnotations()) {
          if (!MEASURE_TOOLS.has(a.metadata?.toolName ?? '')) continue;
          rows.push({
            uid: a.annotationUID!,
            label: annotationLabel(a as Parameters<typeof annotationLabel>[0]),
            world: annotationWorld(a as Parameters<typeof annotationWorld>[0]),
            visible: a.isVisible !== false,
          });
        }
        setMeasures(rows);
        evidenceDirtyRef.current(); // annotations changed ⇒ schedule a sidecar save
      } catch {
        /* store mid-update */
      }
    };
    refreshMeasuresRef.current = refreshMeasures;
    const evts = [
      csToolsEnums.Events.ANNOTATION_COMPLETED,
      csToolsEnums.Events.ANNOTATION_MODIFIED,
      csToolsEnums.Events.ANNOTATION_REMOVED,
    ];
    evts.forEach((e) => eventTarget.addEventListener(e, refreshMeasures));

    // Del/Backspace deletes the selected annotation (object-browser row or an
    // annotation shift-clicked on a pane); V saves the current view. App-level keys
    // (N/P/R/…) live in CbctApp.
    const onKeyDel = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (deleteSelectedRef.current()) e.preventDefault();
      } else if (e.key === 'v' || e.key === 'V') {
        saveViewRef.current();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDel);

    const els = Object.values(elRefs.current);
    const prevent = (e: Event) => e.preventDefault();
    els.forEach((el) => el?.addEventListener('contextmenu', prevent));

    // ---- live HU under the cursor: canvas → world → voxel index (identity direction matrix),
    // mean over a 3×3×3 neighborhood (orientation-agnostic, steadier than a single voxel).
    // Written straight into the chip's textContent — a React state update per mousemove would
    // re-render the whole grid at 60 Hz for one number.
    const sampleHu = (id: string, e: PointerEvent) => {
      const span = huRefs.current[id];
      if (!span) return;
      const meta = metaRef.current;
      const scalar = scalarRef.current;
      const engine = engineRef.current;
      if (!meta || !scalar || !engine) return;
      try {
        const vp = engine.getViewport(id) as Types.IVolumeViewport;
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const w = vp.canvasToWorld([e.clientX - r.left, e.clientY - r.top]);
        const [cols, rows, slices] = meta.dims;
        const ci = Math.round((w[0] - meta.origin[0]) / meta.spacing[0]);
        const ri = Math.round((w[1] - meta.origin[1]) / meta.spacing[1]);
        const si = Math.round((w[2] - meta.origin[2]) / meta.spacing[2]);
        if (ci < 0 || ri < 0 || si < 0 || ci >= cols || ri >= rows || si >= slices) {
          span.textContent = '';
          return;
        }
        let sum = 0;
        let n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const z = si + dz;
          if (z < 0 || z >= slices) continue;
          for (let dy = -1; dy <= 1; dy++) {
            const y = ri + dy;
            if (y < 0 || y >= rows) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const x = ci + dx;
              if (x < 0 || x >= cols) continue;
              sum += scalar[z * rows * cols + y * cols + x];
              n++;
            }
          }
        }
        span.textContent = n ? `${Math.round(sum / n)} HU` : '';
      } catch {
        span.textContent = '';
      }
    };

    // ---- right-drag = rotate the section (clinical-workstation convention): plain drag distance maps
    // linearly to degrees — drag right/up = one way, left/down = the other. No modes.
    const DEG_PER_PX = 0.35;
    const rotCleanups: Array<() => void> = [];
    for (const id of MPR_IDS) {
      const el = elRefs.current[id];
      if (!el) continue;
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      let total = 0;
      let axis: number[] = [0, 0, 1];
      let pivotWorld: number[] = [0, 0, 0];
      const onDown = (e: PointerEvent) => {
        if (e.button !== 2 || e.shiftKey) return; // ⇧+right stays zoom
        const engine = engineRef.current;
        if (!engine) return;
        let vp: Types.IVolumeViewport;
        try {
          vp = engine.getViewport(id) as Types.IVolumeViewport;
        } catch {
          return;
        }
        const cam = vp.getCamera();
        if (!cam.viewPlaneNormal) return;
        axis = normalizeV(cam.viewPlaneNormal as number[]);
        // pivot on the crosshair center when the tool has one — that's the point being studied
        const ch = ToolGroupManager.getToolGroup('tg-cbct-mpr')?.getToolInstance?.(CrosshairsTool.toolName) as
          | { toolCenter?: number[] }
          | undefined;
        const center =
          ch?.toolCenter && ch.toolCenter.some((v) => v !== 0) ? ch.toolCenter : (cam.focalPoint as number[]);
        pivotWorld = [...center];
        lastX = e.clientX;
        lastY = e.clientY;
        total = 0;
        dragging = true;
        e.preventDefault();
        e.stopImmediatePropagation(); // keep Cornerstone's own handlers off the right button
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointer */
        }
        setRotDrag({ id, deg: 0 });
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) {
          sampleHu(id, e);
          return;
        }
        const deg = ((e.clientX - lastX) - (e.clientY - lastY)) * DEG_PER_PX;
        lastX = e.clientX;
        lastY = e.clientY;
        if (!deg) return;
        total += deg;
        applyRotationRef.current(axis, pivotWorld, deg);
        setRotDrag({ id, deg: total });
      };
      const endRot = () => {
        if (!dragging) return;
        dragging = false;
        setRotDrag(null);
      };
      const onLeave = () => {
        const s = huRefs.current[id];
        if (s) s.textContent = '';
      };
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', endRot);
      el.addEventListener('pointercancel', endRot);
      el.addEventListener('pointerleave', onLeave);
      rotCleanups.push(() => {
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', endRot);
        el.removeEventListener('pointercancel', endRot);
        el.removeEventListener('pointerleave', onLeave);
      });
    }

    // ---- 3D box ROI: while the roi3d tool is picked, left-drag on a slice pane rubber-bands
    // a rectangle (live dashed overlay); release turns it into the oriented voxel box. Every
    // Cornerstone tool is passive in this mode, so the left button is ours.
    const roiCleanups: Array<() => void> = [];
    for (const id of MPR_IDS) {
      const el = elRefs.current[id];
      if (!el) continue;
      let start: [number, number] | null = null;
      const local = (e: PointerEvent): [number, number] => {
        const r = el.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      };
      const down = (e: PointerEvent) => {
        if (e.button !== 0 || toolModeRef.current !== 'roi3d') return;
        start = local(e);
        e.preventDefault();
        e.stopImmediatePropagation();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointer */
        }
        setRoiDrag({ id, x: start[0], y: start[1], w: 0, h: 0 });
      };
      const move = (e: PointerEvent) => {
        if (!start) return;
        const p = local(e);
        setRoiDrag({
          id,
          x: Math.min(start[0], p[0]),
          y: Math.min(start[1], p[1]),
          w: Math.abs(p[0] - start[0]),
          h: Math.abs(p[1] - start[1]),
        });
      };
      const up = (e: PointerEvent) => {
        if (!start) return;
        const a = start;
        start = null;
        setRoiDrag(null);
        const b = local(e);
        // a near-click leaves no box behind
        if (Math.abs(b[0] - a[0]) < 6 || Math.abs(b[1] - a[1]) < 6) return;
        finalizeRoiRef.current(id, a, b);
      };
      const cancel = () => {
        start = null;
        setRoiDrag(null);
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', cancel);
      roiCleanups.push(() => {
        el.removeEventListener('pointerdown', down);
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', cancel);
      });
    }

    // ---- cutaway: ⇧right-drag on the 3D pane shaves anatomy off the
    // render. Each drag adds ONE cut plane facing the current viewing direction; dragging
    // pushes it deeper (up = deeper, down = back out). Cuts accumulate across drags from
    // different angles; the ✂ chip clears them all.
    const MM_PER_PX = 0.6;
    const el3d = elRefs.current[VP.v3d];
    let cutting = false;
    let cutLastY = 0;
    let cutDepth = 0;
    let cutVpn: number[] = [0, 0, 1];
    let cutCenter: number[] = [0, 0, 0];
    let cutHalf = 0;
    const cutDown = (e: PointerEvent) => {
      if (e.button !== 2 || !e.shiftKey) return;
      const engine = engineRef.current;
      if (!engine || !metaRef.current) return;
      const info = boundsInfo(engine, VP.v3d);
      if (!info) return;
      let vpn: number[];
      try {
        const cam = engine.getViewport(VP.v3d).getCamera();
        if (!cam.viewPlaneNormal) return;
        vpn = normalizeV(cam.viewPlaneNormal as number[]);
      } catch {
        return;
      }
      cutVpn = vpn;
      cutCenter = info.center;
      cutHalf = info.halfDiag;
      cutDepth = 0;
      cutLastY = e.clientY;
      cutting = true;
      // the cut starts at the camera-side surface; normal points AWAY from the camera so the
      // far half-space is what survives
      cutsRef.current = [
        ...cutsRef.current,
        {
          origin: [
            cutCenter[0] + cutVpn[0] * cutHalf,
            cutCenter[1] + cutVpn[1] * cutHalf,
            cutCenter[2] + cutVpn[2] * cutHalf,
          ],
          normal: [-cutVpn[0], -cutVpn[1], -cutVpn[2]],
        },
      ];
      setCutCount(cutsRef.current.length);
      setCutDrag(0);
      e.preventDefault();
      e.stopImmediatePropagation(); // keep Cornerstone's zoom off this gesture
      try {
        el3d?.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
    };
    const cutMove = (e: PointerEvent) => {
      if (!cutting) return;
      cutDepth = Math.max(0, Math.min(2 * cutHalf, cutDepth + (cutLastY - e.clientY) * MM_PER_PX));
      cutLastY = e.clientY;
      const d = cutHalf - cutDepth;
      const cuts = cutsRef.current;
      cuts[cuts.length - 1] = {
        origin: [cutCenter[0] + cutVpn[0] * d, cutCenter[1] + cutVpn[1] * d, cutCenter[2] + cutVpn[2] * d],
        normal: [-cutVpn[0], -cutVpn[1], -cutVpn[2]],
      };
      setCutDrag(cutDepth);
      reclipRef.current();
    };
    const cutEnd = () => {
      if (!cutting) return;
      cutting = false;
      setCutDrag(null);
      // a drag that never bit into the volume leaves no cut behind
      if (cutDepth < 0.5) {
        cutsRef.current = cutsRef.current.slice(0, -1);
        setCutCount(cutsRef.current.length);
        reclipRef.current();
      }
    };
    el3d?.addEventListener('pointerdown', cutDown);
    el3d?.addEventListener('pointermove', cutMove);
    el3d?.addEventListener('pointerup', cutEnd);
    el3d?.addEventListener('pointercancel', cutEnd);

    // ---- clean-rendering eraser: left-drag paints while eraser mode is on (trackball is
    // set passive then, so the drag can't also orbit). Each sample rays into the volume and
    // blanks a sphere at the first visible surface — "erase what you touch".
    let erasing = false;
    const eraseSample = (e: PointerEvent) => {
      const engine = engineRef.current;
      const er = eraserRef.current;
      const el = elRefs.current[VP.v3d];
      if (!engine || !er || !el) return;
      try {
        const vp = engine.getViewport(VP.v3d);
        const r = el.getBoundingClientRect();
        const p = vp.canvasToWorld([e.clientX - r.left, e.clientY - r.top]) as number[];
        const cam = vp.getCamera();
        const dir = r3dRef.current.perspective
          ? normalizeV([
              p[0] - (cam.position as number[])[0],
              p[1] - (cam.position as number[])[1],
              p[2] - (cam.position as number[])[2],
            ])
          : normalizeV(cam.viewPlaneNormal as number[]).map((v) => -v);
        // "visible" = at/above the render's opacity threshold (clamped so a DRR/MIP threshold of
        // −1000 doesn't make the brush bite pure air)
        const thr = Math.max(r3dRef.current.threshold, -300);
        const zr = er.eraseAt(p, dir, thr, eraseRadiusRef.current);
        if (zr) refreshEraseTextureRef.current(false, zr);
      } catch {
        /* pane mid-swap */
      }
    };
    const erDown = (e: PointerEvent) => {
      if (e.button !== 0 || !eraseModeRef.current || !eraserRef.current) return;
      erasing = true;
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        el3d?.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
      eraserRef.current.beginStroke();
      eraseSample(e);
    };
    const erMove = (e: PointerEvent) => {
      if (erasing) eraseSample(e);
    };
    const erUp = () => {
      if (!erasing) return;
      erasing = false;
      if (eraserRef.current?.endStroke()) {
        refreshEraseTextureRef.current(true, null); // flush whatever the throttle held back
      }
      syncEraseInfoRef.current();
    };
    el3d?.addEventListener('pointerdown', erDown);
    el3d?.addEventListener('pointermove', erMove);
    el3d?.addEventListener('pointerup', erUp);
    el3d?.addEventListener('pointercancel', erUp);

    return () => {
      disposed = true;
      setReady(false);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      window.removeEventListener('keydown', onKeyDel);
      evts.forEach((e) => eventTarget.removeEventListener(e, refreshMeasures));
      els.forEach((el) => el?.removeEventListener('contextmenu', prevent));
      rotCleanups.forEach((f) => f());
      roiCleanups.forEach((f) => f());
      roiOutlinesRef.current?.dispose();
      roiOutlinesRef.current = null;
      el3d?.removeEventListener('pointerdown', cutDown);
      el3d?.removeEventListener('pointermove', cutMove);
      el3d?.removeEventListener('pointerup', cutEnd);
      el3d?.removeEventListener('pointercancel', cutEnd);
      el3d?.removeEventListener('pointerdown', erDown);
      el3d?.removeEventListener('pointermove', erMove);
      el3d?.removeEventListener('pointerup', erUp);
      el3d?.removeEventListener('pointercancel', erUp);
      indicatorsRef.current?.dispose();
      indicatorsRef.current = null;
      purgeMeasurements();
      ToolGroupManager.destroyToolGroup('tg-cbct-mpr');
      ToolGroupManager.destroyToolGroup('tg-cbct-3d');
      try {
        engineRef.current?.destroy();
      } catch {
        /* already gone */
      }
      engineRef.current = null;
      try {
        csCache.purgeCache(); // volumes AND their derived slice images (see ensureLocalVolume)
      } catch {
        /* cache mid-teardown */
      }
      clearVolumeCache();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- volume (re)load: in-place swap, camera preserved across an ARA pair ----------
  useEffect(() => {
    if (!ready) return;
    let stale = false;
    (async () => {
      try {
        setProgress(0);
        const entry = await loadVolumeData(anon, (f) => !stale && setProgress(Math.min(0.94, f)));
        if (stale || !engineRef.current) return;
        metaRef.current = entry.meta;
        scalarRef.current = entry.scalar;
        onMeta?.(entry.meta);
        onHistogram?.(computeHistogram(entry.scalar));

        const isPairSwap =
          prevAnonRef.current !== null &&
          (entry.meta.pair === prevAnonRef.current || prevAnonRef.current === anon);
        // same acquisition ⇒ same geometry ⇒ cameras carry over exactly
        const snap = isPairSwap
          ? MPR_IDS.concat(VP.v3d).map((id) => {
              try {
                return { id, cam: engineRef.current!.getViewport(id).getCamera() };
              } catch {
                return null;
              }
            })
          : [];

        // evidence: stop any pending save FIRST — a debounced save firing after the purge
        // would overwrite the previous volume's sidecar with an empty set
        evidenceReadyRef.current = false;
        foreignEvidenceRef.current = {}; // the next volume's sidecar brings its own foreign fields
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        purgeMeasurements(); // annotations belong to the previous FrameOfReference
        setMeasures([]);
        setRois3d([]); // 3D ROIs belong to the previous volume's voxels
        setViews([]);
        setSelectedUid(null);

        // eraser edits belong to the previous volume's voxels — drop the copy outright
        // (the loop below re-attaches the fresh original to every viewport anyway)
        if (eraseVolIdRef.current) {
          const oldEraseId = eraseVolIdRef.current;
          eraserRef.current = null;
          eraseVolIdRef.current = null;
          setEraseInfo({ undo: 0, redo: 0 });
          setEraseMode(false);
          try {
            csCache.removeVolumeLoadObject(oldEraseId);
          } catch {
            /* not cached */
          }
        }

        const volumeId = ensureLocalVolume(anon, entry);
        await setVolumesForViewports(engineRef.current, [{ volumeId }], [...MPR_IDS, VP.v3d]);
        if (stale) return;

        if (isPairSwap) {
          for (const s of snap) {
            if (!s) continue;
            try {
              engineRef.current.getViewport(s.id).setCamera(s.cam);
            } catch {
              /* pane mid-init */
            }
          }
        } else {
          for (const id of [...MPR_IDS, VP.v3d]) {
            try {
              engineRef.current.getViewport(id).resetCamera();
            } catch {
              /* ignore */
            }
          }
        }
        applyVoi(engineRef.current, controls.voi ?? entry.meta.defaultVoi, controls.invert);
        if (controls.gamma !== 1) {
          applyMprGamma(engineRef.current, controls.voi ?? entry.meta.defaultVoi, controls.invert, controls.gamma);
        }
        try {
          apply3dRender(engineRef.current, VP.v3d, controls.render3d);
          // force: the pre-volume effect may have flipped the projection already, and the
          // fit computed then (or by the cornerstone resetCamera loop above) is wrong for it
          applyProjection(engineRef.current, VP.v3d, controls.render3d.perspective, { force: true });
        } catch (e) {
          console.warn('3d render failed', e);
        }
        // fresh actor ⇒ fresh mapper: clipping planes + indicator geometry must be re-applied.
        // Cuts were made against another acquisition's geometry — drop them unless this is the
        // pair (same acquisition, same frame).
        if (!isPairSwap && cutsRef.current.length) {
          cutsRef.current = [];
          setCutCount(0);
        }
        reclipRef.current();
        try {
          const b = (engineRef.current.getViewport(VP.v3d).getDefaultActor()?.actor as unknown as {
            getBounds?: () => number[];
          })?.getBounds?.();
          if (b && indicatorsRef.current) {
            indicatorsRef.current.setBounds(b);
            updateIndicatorsRef.current();
          }
        } catch {
          /* indicators are cosmetic */
        }
        engineRef.current.renderViewports([...MPR_IDS, VP.v3d]);
        try {
          // volume is attached now, so the tool snapshots real pane corners; respect the O toggle
          if (controls.showOverlay) {
            ToolGroupManager.getToolGroup('tg-cbct-mpr')?.setToolEnabled(ScaleOverlayTool.toolName);
          }
        } catch {
          /* scale bar is optional */
        }
        if (controls.showOverlay && controls.planeLines) {
          reinitCrosshairs(controls.toolMode);
          engineRef.current.renderViewports(MPR_IDS);
          renderAnnotationsNowRef.current(); // lines materialize only on an annotation pass
        }
        prevAnonRef.current = anon;
        setProgress(null);

        // evidence sidecar: bring this volume's annotations / views / 3D ROIs back
        try {
          const ev = await fetchEvidence(anon);
          if (!stale && ev) {
            // carry fields other views own (pano traces, future additions) through our saves
            const OURS = new Set(['schema', 'anon', 'saved_at', 'annotations', 'views', 'rois3d']);
            foreignEvidenceRef.current = Object.fromEntries(
              Object.entries(ev as unknown as Record<string, unknown>).filter(([k]) => !OURS.has(k)),
            );
            for (const raw of ev.annotations ?? []) {
              try {
                const a = raw as { highlighted?: boolean; invalidated?: boolean; annotationUID?: string };
                a.highlighted = false;
                a.invalidated = true; // stats recompute on the next annotation render
                csAnnotation.state.addAnnotation(
                  a as unknown as Parameters<typeof csAnnotation.state.addAnnotation>[0],
                  `cbctscope.${anon}`, // deterministic FrameOfReference ⇒ world coords land exactly
                );
              } catch (e) {
                console.warn('evidence annotation restore failed', e);
              }
            }
            setViews(ev.views ?? []);
            setRois3d((ev.rois3d ?? []).map((r) => ({ ...r, visible: r.visible !== false })));
            engineRef.current.renderViewports(MPR_IDS);
            renderAnnotationsNowRef.current();
            refreshMeasuresRef.current();
          }
        } catch (e) {
          console.warn('evidence load failed', e);
        }
        if (!stale) evidenceReadyRef.current = true;

        // evict volumes outside the {current, pair} working set, then prefetch the partner
        for (const key of keepOnly([anon, entry.meta.pair])) {
          try {
            csCache.removeVolumeLoadObject(`cbctlocal:${key}`);
          } catch {
            /* not cached */
          }
        }
        if (entry.meta.pair) void loadVolumeData(entry.meta.pair).catch(() => undefined);
      } catch (err) {
        console.error('[cbct] load failed', err);
        if (!stale) {
          setProgress(null);
          onError?.('volume load failed — see console');
        }
      }
    })();
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anon, ready]);

  // ---------- controls ----------
  useEffect(() => {
    if (!ready) return;
    const mpr = ToolGroupManager.getToolGroup('tg-cbct-mpr');
    if (!mpr) return;
    for (const t of new Set(Object.values(TOOL_OF))) {
      try {
        // annotation tools park PASSIVE (existing marks stay selectable/editable); crosshairs
        // is handled separately below — passive crosshairs grabs any drag near its full-pane
        // reference lines and steals the stroke from the active annotation tool
        if (t && t !== CrosshairsTool.toolName) mpr.setToolPassive(t);
      } catch {
        /* ignore */
      }
    }
    // `!== false` keeps a dev-mode hot-reload with pre-planeLines state from wedging the
    // lines off with no way back
    const chVisible = controls.showOverlay && controls.planeLines !== false;
    if (chVisible) {
      if (controls.toolMode === 'crosshairs') {
        mpr.setToolActive(CrosshairsTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
      } else {
        mpr.setToolEnabled(CrosshairsTool.toolName); // lines visible, mouse never intercepted
      }
    } // lines hidden ⇒ the planeLines effect below keeps crosshairs disabled
    const primary =
      controls.toolMode === 'crosshairs'
        ? chVisible
          ? null // crosshairs already active above
          : PanTool.toolName // lines hidden ⇒ crosshairs stays disabled; left-click degrades to pan
        : TOOL_OF[controls.toolMode];
    // roi3d: leave every Cornerstone tool passive — the custom box-drag handlers own the left button
    if (primary) mpr.setToolActive(primary, { bindings: [{ mouseButton: MouseBindings.Primary }] });
  }, [controls.toolMode, controls.showOverlay, controls.planeLines, ready]);

  useEffect(() => {
    if (!ready || !engineRef.current || !metaRef.current) return;
    const voi = controls.voi ?? metaRef.current.defaultVoi;
    applyVoi(engineRef.current, voi, controls.invert);
    if (controls.gamma !== 1) applyMprGamma(engineRef.current, voi, controls.invert, controls.gamma);
    engineRef.current.renderViewports(MPR_IDS);
  }, [controls.voi, controls.invert, controls.gamma, ready]);

  useEffect(() => {
    if (!ready || !engineRef.current) return;
    for (const p of MPR_PANES) {
      try {
        const vp = engineRef.current.getViewport(VP[p]) as Types.IVolumeViewport;
        vp.setBlendMode(
          controls.mip ? Enums.BlendModes.MAXIMUM_INTENSITY_BLEND : Enums.BlendModes.COMPOSITE,
        );
        (vp as unknown as { setSlabThickness?: (t: number) => void }).setSlabThickness?.(
          Math.max(0.1, controls.slabByPane[p]),
        );
        vp.render();
      } catch (e) {
        console.warn('slab/mip failed', e);
      }
    }
  }, [controls.slabByPane, controls.mip, ready]);

  // Full 3D-render settings (style + adjust sliders + pseudo-color). Depend on the JSON so a
  // new settings object with identical values doesn't re-fire (App recreates it per keystroke).
  const render3dJson = JSON.stringify(controls.render3d);
  useEffect(() => {
    if (!ready || !engineRef.current) return;
    try {
      apply3dRender(engineRef.current, VP.v3d, controls.render3d);
    } catch (e) {
      console.warn('3d render failed', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render3dJson, ready]);

  // Projection model is separate: applying it re-fits the camera, so only fire on an actual toggle.
  useEffect(() => {
    if (!ready || !engineRef.current) return;
    try {
      applyProjection(engineRef.current, VP.v3d, controls.render3d.perspective);
    } catch (e) {
      console.warn('projection toggle failed', e);
    }
  }, [controls.render3d.perspective, ready]);

  // Crop box (3D render only). cropRef is already current — just rebuild the plane set.
  const cropJson = JSON.stringify(controls.crop3d);
  useEffect(() => {
    if (!ready) return;
    reclipRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropJson, ready]);

  // "clear cuts": drop every cutaway plane.
  useEffect(() => {
    if (!ready || controls.clearCutsNonce === 0) return;
    cutsRef.current = [];
    setCutCount(0);
    reclipRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls.clearCutsNonce]);

  // Eraser mode: prepare the 3D-only voxel copy and park the trackball so left-drag paints
  // instead of orbiting. Leaving the mode keeps the cleaned render —
  // only "revert" restores the full volume.
  useEffect(() => {
    if (!ready) return;
    const t3d = ToolGroupManager.getToolGroup('tg-cbct-3d');
    try {
      if (eraseMode) {
        t3d?.setToolPassive(TrackballRotateTool.toolName);
        void ensureEraseVolume().then(syncEraseInfo);
      } else {
        t3d?.setToolActive(TrackballRotateTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary }],
        });
      }
    } catch (e) {
      console.warn('eraser mode toggle failed', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eraseMode, ready]);

  // Plane indicators in the 3D render — created lazily on first enable (needs the renderer).
  useEffect(() => {
    if (!ready || !engineRef.current) return;
    try {
      if (controls.planes3d && !indicatorsRef.current) {
        const vp = engineRef.current.getViewport(VP.v3d) as unknown as {
          getRenderer: () => { addActor: (a: unknown) => void; removeActor: (a: unknown) => void };
        };
        indicatorsRef.current = new PlaneIndicators(vp.getRenderer());
        const b = (engineRef.current.getViewport(VP.v3d).getDefaultActor()?.actor as unknown as {
          getBounds?: () => number[];
        })?.getBounds?.();
        if (b) indicatorsRef.current.setBounds(b);
      }
      indicatorsRef.current?.setVisible(controls.planes3d);
      updateIndicatorsRef.current();
      engineRef.current.getViewport(VP.v3d).render();
    } catch (e) {
      console.warn('plane indicators failed', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls.planes3d, ready]);

  // 3D ROI outlines follow the ROI list + selection (created lazily — needs the renderer).
  useEffect(() => {
    if (!ready || !engineRef.current) return;
    try {
      if (rois3d.length && !roiOutlinesRef.current) {
        const vp = engineRef.current.getViewport(VP.v3d) as unknown as {
          getRenderer: () => { addActor: (a: unknown) => void; removeActor: (a: unknown) => void };
        };
        roiOutlinesRef.current = new Roi3dOutlines(
          vp.getRenderer(),
          VTK_KIT as unknown as ConstructorParameters<typeof Roi3dOutlines>[1],
        );
      }
      const selectedRoiId = selectedUid?.startsWith('roi3d:') ? selectedUid.slice(6) : null;
      roiOutlinesRef.current?.sync(rois3d, selectedRoiId);
      engineRef.current.getViewport(VP.v3d).render();
    } catch (e) {
      console.warn('roi3d outlines failed', e);
    }
    evidenceDirtyRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rois3d, selectedUid, ready]);

  // R / "Reset orientation": cameras back to orthogonal only — window, slabs, everything else stays.
  useEffect(() => {
    if (!ready || !engineRef.current || controls.resetNonce === 0) return;
    resetPaneCameras(engineRef.current);
    // under perspective the cornerstone reset mis-fits the 3D camera — re-fit for the model
    try {
      applyProjection(engineRef.current, VP.v3d, controls.render3d.perspective, { force: true });
    } catch {
      /* 3D pane mid-init */
    }
    if (controls.showOverlay && controls.planeLines) reinitCrosshairs(controls.toolMode);
    engineRef.current.renderViewports([...MPR_IDS, VP.v3d]);
    renderAnnotationsNowRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls.resetNonce]);

  // "Reset all": cameras + window back to the volume's defaults.
  useEffect(() => {
    if (!ready || !engineRef.current || controls.fullResetNonce === 0) return;
    resetPaneCameras(engineRef.current);
    try {
      applyProjection(engineRef.current, VP.v3d, controls.render3d.perspective, { force: true });
    } catch {
      /* 3D pane mid-init */
    }
    if (metaRef.current) applyVoi(engineRef.current, metaRef.current.defaultVoi, false);
    if (controls.showOverlay && controls.planeLines) reinitCrosshairs(controls.toolMode);
    engineRef.current.renderViewports([...MPR_IDS, VP.v3d]);
    renderAnnotationsNowRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls.fullResetNonce]);

  // Force the annotation pass on OUR live pane elements. The by-viewportId variant
  // (triggerAnnotationRenderForViewportIds) can resolve to a stale enabled-element left
  // over from a torn-down engine (StrictMode double-mount / view-mode remount share the
  // same viewport ids), silently re-rendering nothing — the drawn SVG then never updates.
  const renderAnnotationsNow = () => {
    for (const id of MPR_IDS) {
      const el = elRefs.current[id];
      if (!el) continue;
      try {
        (csToolsUtils as unknown as { triggerAnnotationRender: (el: HTMLDivElement) => void }).triggerAnnotationRender(el);
      } catch {
        /* element mid-teardown */
      }
    }
  };
  const renderAnnotationsNowRef = useRef(renderAnnotationsNow);
  renderAnnotationsNowRef.current = renderAnnotationsNow;

  // Plane lines + overlay master switch. Lines show only when BOTH planeLines and showOverlay
  // are on; turning them (back) on always goes through reinitCrosshairs — a plain re-enable can
  // leave lines missing on some panes (annotations lost after disable + camera changes).
  useEffect(() => {
    if (!ready) return;
    const mpr = ToolGroupManager.getToolGroup('tg-cbct-mpr');
    if (!mpr) return;
    const chVisible = controls.showOverlay && controls.planeLines !== false;
    try {
      if (!chVisible) {
        mpr.setToolDisabled(CrosshairsTool.toolName);
        // belt + braces: with the annotations gone there is nothing to draw even if some
        // other path re-renders later
        for (const a of csAnnotation.state.getAllAnnotations()) {
          if (a.metadata?.toolName === CrosshairsTool.toolName) {
            csAnnotation.state.removeAnnotation(a.annotationUID!);
          }
        }
      } else reinitCrosshairs(controls.toolMode);
      if (!controls.showOverlay) mpr.setToolDisabled(ScaleOverlayTool.toolName);
      // enable only once a volume is attached: enabling earlier makes the tool snapshot the
      // pane corners off a viewport with NO image data → an empty-points annotation that
      // crashes the next annotation render pass (the startup "reading '0'" TypeError)
      else if (metaRef.current) mpr.setToolEnabled(ScaleOverlayTool.toolName);
      for (const a of csAnnotation.state.getAllAnnotations()) {
        if (MEASURE_TOOLS.has(a.metadata?.toolName ?? '')) {
          // the master switch re-shows everything — per-row 👁 hides are session whims, not state
          csAnnotation.visibility.setAnnotationVisibility(a.annotationUID!, controls.showOverlay);
        }
      }
      engineRef.current?.renderViewports(MPR_IDS);
      renderAnnotationsNow();
    } catch (e) {
      console.warn('overlay toggle failed', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls.showOverlay, controls.planeLines, ready]);

  // resize on container OR maximize change
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    let raf = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    // ⚠ ContextPoolRenderingEngine SILENTLY SKIPS the canvas-backing resize while a render
    // animation frame is pending — and an agent-driven mode/pane change (or a divider drag)
    // triggers renders constantly, so a single resize call is a lottery. When the backing
    // stays stale, every overlay projection (reference lines, evidence ROIs) is computed
    // against the wrong transform and misplaces. Verify every pane's backing against
    // element×dpr and retry until it converges.
    const backingStale = (): boolean => {
      try {
        const dpr = window.devicePixelRatio || 1;
        for (const id of [VP.axial, VP.sagittal, VP.coronal, VP.v3d]) {
          const el = elRefs.current[id];
          const c = el?.querySelector('canvas');
          if (!el || !c || el.clientWidth === 0) continue;
          if (
            Math.abs(c.width - Math.round(el.clientWidth * dpr)) > 2 ||
            Math.abs(c.height - Math.round(el.clientHeight * dpr)) > 2
          )
            return true;
        }
      } catch {
        /* mid-teardown */
      }
      return false;
    };
    const doResize = (attempt = 0) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          engineRef.current?.resize(true, true); // keepCamera — a maximize/reflow must not reset the slice
        } catch {
          /* mid-teardown */
        }
        if (retry) clearTimeout(retry);
        if (backingStale() && attempt < 12) retry = setTimeout(() => doResize(attempt + 1), 120);
      });
    };
    const ro = new ResizeObserver(() => doResize());
    ro.observe(grid);
    // the pane elements too: maximizing a pane (or a divider drag) changes the internal
    // split without moving the container, so observing only the grid would leave the
    // canvases stale-sized
    for (const id of [VP.axial, VP.sagittal, VP.coronal, VP.v3d]) {
      const el = elRefs.current[id];
      if (el) ro.observe(el);
    }
    doResize();
    return () => {
      cancelAnimationFrame(raf);
      if (retry) clearTimeout(retry);
      ro.disconnect();
    };
  }, [maximized]);

  const cells = useMemo(
    () =>
      [
        { id: VP.axial, label: 'AXIAL' },
        { id: VP.sagittal, label: 'SAGITTAL' },
        { id: VP.coronal, label: 'CORONAL' },
        { id: VP.v3d, label: '3D' },
      ] as const,
    [],
  );

  const deleteMeasure = (uid: string) => {
    try {
      csAnnotation.state.removeAnnotation(uid);
      engineRef.current?.renderViewports(MPR_IDS);
      renderAnnotationsNowRef.current();
    } catch {
      /* already gone */
    }
    setMeasures((m) => m.filter((r) => r.uid !== uid));
    setSelectedUid((s) => (s === uid ? null : s));
  };

  // Per-row 👁: hide one annotation without deleting it (the O key stays the master switch).
  const toggleMeasureVisible = (uid: string, visible: boolean) => {
    try {
      csAnnotation.visibility.setAnnotationVisibility(uid, visible);
      engineRef.current?.renderViewports(MPR_IDS);
      renderAnnotationsNowRef.current();
    } catch {
      /* already gone */
    }
    setMeasures((m) => m.map((r) => (r.uid === uid ? { ...r, visible } : r)));
  };

  // Row click: select (Del deletes it) + re-slice all three panes onto the object.
  const pickMeasure = (row: MeasureRow) => {
    setSelectedUid((s) => (s === row.uid ? null : row.uid));
    if (row.world) jumpPanesToWorld(row.world);
  };

  const mk = (id: string): Markers | undefined => markers[id];

  // Flip a pane's viewing direction — mirror the camera through the focal point (e.g. view the
  // sagittal from patient-left instead of patient-right). The orientation letters recompute
  // from the live camera, so they stay honest after the flip.
  const flipPane = (id: string) => {
    const vp = engineRef.current?.getViewport(id) as Types.IVolumeViewport | undefined;
    if (!vp) return;
    try {
      const cam = vp.getCamera();
      const fp = cam.focalPoint as number[];
      const pos = cam.position as number[];
      vp.setCamera({
        position: [2 * fp[0] - pos[0], 2 * fp[1] - pos[1], 2 * fp[2] - pos[2]] as Types.Point3,
      });
      vp.render();
    } catch {
      /* not ready */
    }
  };

  // explicit rotate controls for the 3D pane (orbit around the focal point)
  const orbit3d = (yawDeg: number, pitchDeg: number) => {
    const vp = engineRef.current?.getViewport(VP.v3d);
    if (!vp) return;
    try {
      const cam = vp.getCamera();
      const fp = cam.focalPoint as number[];
      const pos = cam.position as number[];
      let up = normalizeV(cam.viewUp as number[]);
      let v = [pos[0] - fp[0], pos[1] - fp[1], pos[2] - fp[2]];
      if (yawDeg) v = rotateVec(v, up, yawDeg);
      if (pitchDeg) {
        const right = normalizeV(cross(up, v));
        v = rotateVec(v, right, pitchDeg);
        up = rotateVec(up, right, pitchDeg);
      }
      vp.setCamera({
        position: [fp[0] + v[0], fp[1] + v[1], fp[2] + v[2]] as Types.Point3,
        viewUp: up as Types.Point3,
      });
      vp.render();
    } catch (e) {
      console.warn('orbit failed', e);
    }
  };

  // Hold-to-repeat for the orbit buttons: fire on press, then keep stepping while held.
  const orbitTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopOrbitRepeat = () => {
    if (orbitTimer.current) {
      clearInterval(orbitTimer.current);
      orbitTimer.current = null;
    }
  };
  const holdOrbit = (yawDeg: number, pitchDeg: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      orbit3d(yawDeg, pitchDeg);
      stopOrbitRepeat();
      orbitTimer.current = setInterval(() => orbit3d(yawDeg, pitchDeg), 130);
    },
    onPointerUp: stopOrbitRepeat,
    onPointerLeave: stopOrbitRepeat,
  });
  useEffect(() => stopOrbitRepeat, []);

  // Re-home only the 3D pane's camera (Reset views resets window/slices/everything).
  // Projection-aware: a plain resetCamera under perspective leaves the volume a dot.
  const home3d = () => {
    if (!engineRef.current) return;
    try {
      applyProjection(engineRef.current, VP.v3d, controls.render3d.perspective, { force: true });
    } catch {
      /* not ready */
    }
  };

  // positioning slider per MPR pane — jump that pane to an absolute slice index
  const jumpTo = (id: string, index: number) => {
    const el = elRefs.current[id];
    if (!el) return;
    try {
      void (csUtils as unknown as {
        jumpToSlice: (el: HTMLDivElement, opts: { imageIndex: number }) => Promise<void>;
      }).jumpToSlice(el, { imageIndex: index });
    } catch (e) {
      console.warn('jumpToSlice failed', e);
    }
  };

  // agent bridge: slice navigation requests from useAgentBridge (MPR panes only)
  useEffect(() => {
    const onNav = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        pane?: string;
        index?: number;
        delta?: number;
        reply?: (ok: boolean, error?: string) => void;
      };
      const reply = detail?.reply ?? (() => {});
      const pane = String(detail?.pane ?? '');
      if (!MPR_PANES.includes(pane as MprPane)) {
        reply(false, `pane must be one of: ${MPR_PANES.join(', ')}`);
        return;
      }
      const id = VP[pane as MprPane];
      const info = sliceInfoRef.current[id];
      if (!info) {
        reply(false, 'pane not ready');
        return;
      }
      let target: number;
      if (typeof detail.index === 'number') target = Math.round(detail.index);
      else if (typeof detail.delta === 'number') target = info.idx + Math.round(detail.delta);
      else {
        reply(false, 'index or delta required');
        return;
      }
      target = Math.max(0, Math.min(info.n - 1, target));
      jumpTo(id, target);
      reply(true);
      e.preventDefault();
    };
    window.addEventListener('cbctscope-agent-nav', onNav);
    return () => window.removeEventListener('cbctscope-agent-nav', onNav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={gridRef}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 6,
        width: '100%',
        height: '100%',
        minHeight: 0,
      }}
    >
      {cells.map((c) => {
        const isMax = maximized === c.id;
        const hidden = maximized !== null && !isMax;
        return (
          <div
            key={c.id}
            onDoubleClick={() => setMaximized((m) => (m === c.id ? null : c.id))}
            title="double-click: maximize / restore"
            style={{
              position: isMax ? 'absolute' : 'relative',
              inset: isMax ? 0 : undefined,
              zIndex: isMax ? 2 : undefined,
              visibility: hidden ? 'hidden' : 'visible',
              minHeight: 0,
              minWidth: 0,
            }}
          >
            <div
              ref={(el) => {
                elRefs.current[c.id] = el;
              }}
              style={{ width: '100%', height: '100%', background: 'var(--viewport-bg)', borderRadius: 4 }}
            />
            <span
              style={{
                position: 'absolute',
                top: 6,
                left: 8,
                fontSize: 11,
                letterSpacing: 0.5,
                color: c.id === VP.v3d ? 'var(--text-dim)' : (REFLINE_COLORS[c.id] ?? 'var(--text-dim)'),
                textShadow: '0 1px 2px #000',
                pointerEvents: 'none',
              }}
            >
              {c.label}
              {sliceInfo[c.id] ? `  ${sliceInfo[c.id].idx + 1}/${sliceInfo[c.id].n}` : ''}
            </span>
            {c.id !== VP.v3d && (
              <span
                ref={(el) => {
                  huRefs.current[c.id] = el;
                }}
                style={{
                  position: 'absolute',
                  bottom: 6,
                  left: 8,
                  fontSize: 11,
                  fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text)',
                  textShadow: '0 1px 3px #000',
                  pointerEvents: 'none',
                }}
              />
            )}
            {c.id !== VP.v3d && (
              <button
                onClick={() => flipPane(c.id)}
                onDoubleClick={(e) => e.stopPropagation()}
                title="flip viewing direction (mirror this pane)"
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 26,
                  width: 26,
                  height: 22,
                  borderRadius: 5,
                  border: '1px solid var(--border)',
                  background: 'rgba(27,31,39,0.85)',
                  color: 'var(--text)',
                  fontSize: 12,
                  lineHeight: '18px',
                  padding: 0,
                  zIndex: 1,
                }}
              >
                ⇋
              </button>
            )}
            {c.id !== VP.v3d &&
              controls.showOverlay &&
              mk(c.id) &&
              (
                [
                  ['top', { top: 4, left: '50%', transform: 'translateX(-50%)' }],
                  ['bottom', { bottom: 4, left: '50%', transform: 'translateX(-50%)' }],
                  ['left', { left: 6, top: '50%', transform: 'translateY(-50%)' }],
                  ['right', { right: 30, top: '50%', transform: 'translateY(-50%)' }],
                ] as [keyof Markers, React.CSSProperties][]
              ).map(([side, pos]) => (
                <span
                  key={side}
                  style={{
                    position: 'absolute',
                    ...pos,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#cfd6e4',
                    textShadow: '0 1px 3px #000',
                    pointerEvents: 'none',
                  }}
                >
                  {mk(c.id)![side]}
                </span>
              ))}
            {c.id !== VP.v3d && sliceInfo[c.id] && (
              <>
                <input
                  className="vslice"
                  type="range"
                  min={0}
                  max={Math.max(0, sliceInfo[c.id].n - 1)}
                  step={1}
                  value={sliceValue(c.id, sliceInfo[c.id])}
                  onChange={(e) => jumpTo(c.id, sliceIndexFor(c.id, Number(e.target.value), sliceInfo[c.id].n))}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setDragSlice(c.id);
                  }}
                  onPointerUp={() => setDragSlice(null)}
                  onLostPointerCapture={() => setDragSlice(null)}
                  onDoubleClick={(e) => e.stopPropagation()}
                  title={SLIDER_TIP[c.id] ?? 'slice position'}
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
                {dragSlice === c.id && (
                  <div style={{ position: 'absolute', top: 26, bottom: 26, right: 26, pointerEvents: 'none', zIndex: 2 }}>
                    <span
                      style={{
                        position: 'absolute',
                        right: 0,
                        top: `${(1 - sliceValue(c.id, sliceInfo[c.id]) / Math.max(1, sliceInfo[c.id].n - 1)) * 100}%`,
                        transform: 'translateY(-50%)',
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(20,23,29,0.92)',
                        border: '1px solid var(--border)',
                        fontSize: 11,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                        color: 'var(--text)',
                      }}
                    >
                      {sliceInfo[c.id].idx + 1}/{sliceInfo[c.id].n}
                    </span>
                  </div>
                )}
              </>
            )}
            {roiDrag?.id === c.id && (
              <>
                <div
                  style={{
                    position: 'absolute',
                    left: roiDrag.x,
                    top: roiDrag.y,
                    width: roiDrag.w,
                    height: roiDrag.h,
                    border: '1.5px dashed #ffa040',
                    background: 'rgba(255,160,64,0.12)',
                    pointerEvents: 'none',
                    zIndex: 2,
                  }}
                />
                <span
                  style={{
                    position: 'absolute',
                    top: 26,
                    left: 8,
                    zIndex: 2,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: 'rgba(20,23,29,0.92)',
                    border: '1px solid var(--border)',
                    fontSize: 11,
                    color: '#ffb45e',
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  3D ROI · depth {controls.roi3dDepth} mm into the slice
                </span>
              </>
            )}
            {rotDrag?.id === c.id && (
              <span
                style={{
                  position: 'absolute',
                  top: 26,
                  left: 8,
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
                rotating {rotDrag.deg >= 0 ? '+' : ''}
                {rotDrag.deg.toFixed(0)}° · R = reset
              </span>
            )}
            {c.id === VP.v3d && (
              <div
                onDoubleClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 8,
                  display: 'flex',
                  gap: 4,
                  zIndex: 1,
                  alignItems: 'center',
                }}
              >
                {(
                  [
                    ['⟲', [-14, 0], 'orbit left (hold to keep turning)'],
                    ['⟳', [14, 0], 'orbit right (hold to keep turning)'],
                    ['↑', [0, 10], 'orbit up (hold to keep turning)'],
                    ['↓', [0, -10], 'orbit down (hold to keep turning)'],
                  ] as [string, [number, number], string][]
                ).map(([g, [yaw, pitch], tip]) => (
                  <button
                    key={tip}
                    {...holdOrbit(yaw, pitch)}
                    title={tip}
                    style={{
                      width: 26,
                      height: 24,
                      borderRadius: 5,
                      border: '1px solid var(--border)',
                      background: 'rgba(27,31,39,0.85)',
                      color: 'var(--text)',
                      fontSize: 13,
                      lineHeight: '20px',
                      padding: 0,
                    }}
                  >
                    {g}
                  </button>
                ))}
                <button
                  onClick={home3d}
                  title="re-home the 3D view (rotation/zoom only — window and slices untouched)"
                  style={{
                    width: 26,
                    height: 24,
                    borderRadius: 5,
                    border: '1px solid var(--border)',
                    background: 'rgba(27,31,39,0.85)',
                    color: 'var(--text)',
                    fontSize: 13,
                    lineHeight: '20px',
                    padding: 0,
                  }}
                >
                  ⌂
                </button>
                <span style={{ fontSize: 10, color: 'var(--text-dim)', textShadow: '0 1px 2px #000' }}>
                  {eraseMode ? 'drag = erase' : 'drag = rotate · ⇧right-drag = slice in'}
                </span>
              </div>
            )}
            {c.id === VP.v3d && (
              <div
                onDoubleClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: 34,
                  right: 8,
                  display: 'flex',
                  gap: 4,
                  zIndex: 1,
                  alignItems: 'center',
                }}
              >
                <button
                  onClick={() => setEraseMode((m) => !m)}
                  title="render eraser: erase what you touch on the render (a 3D-only copy — the slices NEVER change)"
                  style={{
                    height: 24,
                    padding: '0 8px',
                    borderRadius: 5,
                    border: '1px solid var(--border)',
                    background: eraseMode ? 'var(--accent-dim)' : 'rgba(27,31,39,0.85)',
                    color: 'var(--text)',
                    fontSize: 11,
                  }}
                >
                  ⌫ eraser
                </button>
                {eraseMode && (
                  <>
                    <input
                      type="range"
                      min={1}
                      max={12}
                      step={0.5}
                      value={eraseRadius}
                      onChange={(e) => setEraseRadius(Number(e.target.value))}
                      title={`brush radius ${eraseRadius} mm`}
                      style={{ width: 70 }}
                    />
                    <span style={{ fontSize: 10, color: 'var(--text)', textShadow: '0 1px 2px #000' }}>
                      {eraseRadius}mm
                    </span>
                    <button
                      onClick={() => {
                        const zr = eraserRef.current?.undo();
                        if (zr) {
                          refreshEraseTextureRef.current(true, zr);
                          syncEraseInfo();
                        }
                      }}
                      disabled={eraseInfo.undo === 0}
                      title="undo the last erase stroke"
                      style={{
                        width: 26,
                        height: 24,
                        borderRadius: 5,
                        border: '1px solid var(--border)',
                        background: 'rgba(27,31,39,0.85)',
                        color: eraseInfo.undo ? 'var(--text)' : 'var(--text-dim)',
                        fontSize: 12,
                        padding: 0,
                      }}
                    >
                      ↶
                    </button>
                    <button
                      onClick={() => {
                        const zr = eraserRef.current?.redo();
                        if (zr) {
                          refreshEraseTextureRef.current(true, zr);
                          syncEraseInfo();
                        }
                      }}
                      disabled={eraseInfo.redo === 0}
                      title="redo the undone erase stroke"
                      style={{
                        width: 26,
                        height: 24,
                        borderRadius: 5,
                        border: '1px solid var(--border)',
                        background: 'rgba(27,31,39,0.85)',
                        color: eraseInfo.redo ? 'var(--text)' : 'var(--text-dim)',
                        fontSize: 12,
                        padding: 0,
                      }}
                    >
                      ↷
                    </button>
                    <button
                      onClick={() => {
                        void dropEraseVolume(true).then(() => {
                          if (eraseModeRef.current) void ensureEraseVolume().then(syncEraseInfo);
                        });
                      }}
                      disabled={eraseInfo.undo === 0 && eraseInfo.redo === 0}
                      title="revert every erase — the full volume returns to the render"
                      style={{
                        height: 24,
                        padding: '0 8px',
                        borderRadius: 5,
                        border: '1px solid var(--border)',
                        background: 'rgba(27,31,39,0.85)',
                        color: eraseInfo.undo || eraseInfo.redo ? 'var(--text)' : 'var(--text-dim)',
                        fontSize: 11,
                      }}
                    >
                      revert
                    </button>
                  </>
                )}
              </div>
            )}
            {c.id === VP.v3d && cutDrag !== null && (
              <span
                style={{
                  position: 'absolute',
                  top: 34,
                  left: 8,
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
                slicing {cutDrag.toFixed(0)} mm deep
              </span>
            )}
            {c.id === VP.v3d && cutCount > 0 && (
              <button
                onClick={() => {
                  cutsRef.current = [];
                  setCutCount(0);
                  reclipRef.current();
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                title="remove every cutaway cut from the 3D render"
                style={{
                  position: 'absolute',
                  bottom: 6,
                  left: 8,
                  zIndex: 1,
                  padding: '3px 8px',
                  borderRadius: 5,
                  border: '1px solid var(--border)',
                  background: 'rgba(27,31,39,0.9)',
                  color: 'var(--text)',
                  fontSize: 11,
                }}
              >
                ✂ {cutCount} cut{cutCount > 1 ? 's' : ''} · clear
              </button>
            )}
          </div>
        );
      })}

      <div
        onDoubleClick={(e) => e.stopPropagation()}
        // centered over the axial pane, one row BELOW its label (top 4 clipped the label's
        // slice counter; grid center collides with the sagittal label; corners are taken)
        style={{
          position: 'absolute',
          top: 26,
          left: '25%',
          transform: 'translateX(-50%)',
          zIndex: 3,
          display: 'flex',
          gap: 6,
        }}
      >
        <button
          onClick={() => void takeSnapshot()}
          title="snapshot: save the current layout (annotations included) as a PNG image"
          style={{
            height: 24,
            padding: '0 10px',
            borderRadius: 5,
            border: '1px solid var(--border)',
            background: 'rgba(27,31,39,0.9)',
            color: 'var(--text)',
            fontSize: 11,
          }}
        >
          📷 snapshot
        </button>
        <button
          onClick={saveView}
          title="save the current view — all four cameras + window + render settings, under a name (V)"
          style={{
            height: 24,
            padding: '0 10px',
            borderRadius: 5,
            border: '1px solid var(--border)',
            background: 'rgba(27,31,39,0.9)',
            color: 'var(--text)',
            fontSize: 11,
          }}
        >
          🔖 save view (V)
        </button>
      </div>

      {controls.showOverlay && (measures.length > 0 || rois3d.length > 0 || views.length > 0) && (
        <div
          style={{
            position: 'absolute',
            bottom: 10,
            right: 10,
            zIndex: 3,
            background: 'rgba(20,23,29,0.92)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            maxHeight: 220,
            maxWidth: 300,
            overflowY: 'auto',
          }}
        >
          <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: 0.4 }}>
            OBJECTS — click: show it on the slices · Del: delete selected
          </div>
          {measures.map((m) => (
            <div
              key={m.uid}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                padding: '1px 4px',
                borderRadius: 4,
                background: selectedUid === m.uid ? 'var(--accent-dim)' : 'transparent',
              }}
            >
              <button
                onClick={() => toggleMeasureVisible(m.uid, !m.visible)}
                title={m.visible ? 'hide this object' : 'show this object'}
                style={{
                  background: 'none',
                  border: 'none',
                  color: m.visible ? 'var(--text)' : 'var(--text-dim)',
                  padding: 0,
                  fontSize: 12,
                  width: 18,
                }}
              >
                {m.visible ? '👁' : '–'}
              </button>
              <button
                onClick={() => pickMeasure(m)}
                title="select + jump the slices to this object"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text)',
                  padding: 0,
                  fontSize: 12,
                  flex: 1,
                  textAlign: 'left',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {m.label}
              </button>
              <button
                onClick={() => deleteMeasure(m.uid)}
                title="delete this object"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-dim)',
                  padding: 0,
                  fontSize: 12,
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {rois3d.map((roi) => {
            const uid = `roi3d:${roi.id}`;
            const s = roi.stats;
            const dims = roi.half.map((h) => (h * 2).toFixed(0)).join('×');
            return (
              <div
                key={uid}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  padding: '1px 4px',
                  borderRadius: 4,
                  background: selectedUid === uid ? 'var(--accent-dim)' : 'transparent',
                }}
              >
                <button
                  onClick={() => {
                    setRois3d((rs) => rs.map((r) => (r.id === roi.id ? { ...r, visible: !r.visible } : r)));
                  }}
                  title={roi.visible ? 'hide this 3D ROI outline' : 'show this 3D ROI outline'}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: roi.visible ? 'var(--text)' : 'var(--text-dim)',
                    padding: 0,
                    fontSize: 12,
                    width: 18,
                  }}
                >
                  {roi.visible ? '👁' : '–'}
                </button>
                <button
                  onClick={() => {
                    setSelectedUid((cur) => (cur === uid ? null : uid));
                    jumpPanesToWorld(roi.center);
                  }}
                  title={`3D box ROI ${dims} mm · ${s.nVoxels.toLocaleString()} voxels · min ${Math.round(s.minHu)} / max ${Math.round(s.maxHu)} HU — click: jump the slices to it`}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ffb45e',
                    padding: 0,
                    fontSize: 12,
                    flex: 1,
                    textAlign: 'left',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  ⧈ {s.volumeCm3 >= 1 ? s.volumeCm3.toFixed(1) : s.volumeCm3.toFixed(2)} cm³ ·{' '}
                  {Math.round(s.meanHu)}±{Math.round(s.sdHu)} HU
                </button>
                <button
                  onClick={() => {
                    setRois3d((rs) => rs.filter((r) => r.id !== roi.id));
                    setSelectedUid((cur) => (cur === uid ? null : cur));
                  }}
                  title="delete this 3D ROI"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-dim)',
                    padding: 0,
                    fontSize: 12,
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
          {views.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: 0.4, marginTop: 2 }}>
              VIEWS — click: restore that exact presentation
            </div>
          )}
          {views.map((v) => (
            <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '1px 4px' }}>
              <span style={{ width: 18, textAlign: 'center' }}>🔖</span>
              <button
                onClick={() => restoreView(v)}
                title="restore this saved view (cameras + window + render settings)"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text)',
                  padding: 0,
                  fontSize: 12,
                  flex: 1,
                  textAlign: 'left',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {v.name}
              </button>
              <button
                onClick={() => setViews((vs) => vs.filter((x) => x.id !== v.id))}
                title="delete this saved view"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-dim)',
                  padding: 0,
                  fontSize: 12,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {progress !== null && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            background: 'rgba(12,14,18,0.82)',
            zIndex: 5,
            borderRadius: 4,
          }}
        >
          <div style={{ color: 'var(--text-dim)' }}>loading volume… {Math.round(progress * 100)}%</div>
          <div style={{ width: 260, height: 6, background: 'var(--panel-2)', borderRadius: 3 }}>
            <div
              style={{
                width: `${Math.round(progress * 100)}%`,
                height: '100%',
                background: 'var(--accent)',
                borderRadius: 3,
                transition: 'width 120ms',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function applyVoi(
  engine: RenderingEngine,
  voi: { center: number; width: number },
  invert: boolean,
) {
  for (const id of MPR_IDS) {
    try {
      const vp = engine.getViewport(id) as Types.IVolumeViewport;
      vp.setProperties({
        voiRange: { lower: voi.center - voi.width / 2, upper: voi.center + voi.width / 2 },
        invert,
      });
    } catch {
      /* pane mid-init */
    }
  }
}
