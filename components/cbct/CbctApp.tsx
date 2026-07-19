'use client';
// CBCT reading app — the client shell. Owns all control state and the volume picker;
// CbctViewport (keyed by volume id, so switching = clean remount) does the rendering.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CONSTANTS } from '@cornerstonejs/core';
import CbctViewport, {
  type CbctControls,
  type CbctMeta,
  type CbctToolMode,
  type Crop3d,
  type HistogramData,
  type MprPane,
} from './CbctViewport';
import { RENDER_STYLES, DEFAULT_RENDER3D, type Render3dSettings, type PseudoKey } from './render3d';
import CbctPano from './CbctPano';
import CbctGrid from './CbctGrid';
import CbctRadiograph from './CbctRadiograph';
import CbctHistogram from './CbctHistogram';
import CbctTmj from './CbctTmj';
import CbctReslice from './CbctReslice';
import CbctCeph from './CbctCeph';
import CbctRegion from './CbctRegion';
import CbctStitch from './CbctStitch';
import { useAgentBridge } from './useAgentBridge';

interface ListEntry {
  anon: string;
  /** 'mf' | 'slices' = CBCT volume · 'xray' = single 2D radiograph */
  kind: 'mf' | 'slices' | 'xray';
  dims: [number, number, number];
  spacing: [number, number, number];
  fov: [number, number];
  region: string;
  year: string;
  pair: string | null;
  /** display name (opened local volumes and the demo phantom carry one) */
  label?: string;
}

/** User-opened local volume (📂 open). */
const isLocalVol = (id: string) => id.startsWith('local_');
/** Session-scoped stitched (fused) volume from the Stitch view. */
const isFusedVol = (id: string) => id.startsWith('fused_');
/** Built-in synthetic demo phantom. */
const isDemoVol = (id: string) => id.startsWith('demo_');

type ViewMode = 'mpr' | 'grid' | 'pano' | 'tmj' | 'reslice' | 'ceph' | 'region' | 'stitch';
const VIEW_MODES: [ViewMode, string, string][] = [
  ['mpr', 'MPR', 'orthogonal slices + 3D render'],
  ['grid', 'Grid', 'many parallel slices on one screen'],
  ['pano', 'Pano', 'curved panoramic + cross-sections'],
  ['tmj', 'TMJ', 'both condyles in axis-corrected sections'],
  ['reslice', 'Reslice', 'new slice stack along any drawn line or curve'],
  ['ceph', 'Ceph', 'virtual cephalogram — the volume projected flat like a film'],
  ['region', 'Region', 'region growing + airway analysis'],
  ['stitch', 'Stitch', 'register + merge two volumes of the same subject'],
];

// Window presets in HU (rescale is baked into the voxels server-side). CBCT HU calibration is
// approximate by nature — these are starting points, not gospel.
const WL_PRESETS: Record<string, { center: number; width: number } | null> = {
  Auto: null, // volume's own robust percentile window
  Bone: { center: 700, width: 4000 },
  Teeth: { center: 1400, width: 3200 },
  Soft: { center: 150, width: 900 },
};

// Tool palette (left mouse button) — order defines the 1–9 hotkeys (0 = the tenth).
const TOOL_ORDER: readonly CbctToolMode[] = [
  'crosshairs',
  'pan',
  'length',
  'angle',
  'arrow',
  'text',
  'rect',
  'ellipse',
  'freehand',
  'roi3d',
] as const;
const TOOL_LABEL: Record<CbctToolMode, string> = {
  crosshairs: 'Crosshairs',
  pan: 'Pan',
  length: 'Length',
  angle: 'Angle',
  arrow: 'Arrow',
  text: 'Text',
  rect: 'Rect ROI',
  ellipse: 'Ellipse ROI',
  freehand: 'Freehand',
  roi3d: '3D ROI',
};

const defaultControls: CbctControls = {
  toolMode: 'crosshairs',
  roi3dDepth: 10,
  voi: null,
  invert: false,
  slabByPane: { axial: 0.1, sagittal: 0.1, coronal: 0.1 },
  mip: false,
  render3d: DEFAULT_RENDER3D,
  crop3d: { x: [0, 1], y: [0, 1], z: [0, 1] },
  planes3d: false,
  clearCutsNonce: 0,
  planeLines: true,
  showOverlay: true,
  gamma: 1,
  resetNonce: 0,
  fullResetNonce: 0,
};

// Custom 3D presets ("save current adjustments as a style"): named Render3dSettings
// snapshots in localStorage; one can be marked default and loads on app start.
const PRESETS_KEY = 'cbctscope-3d-presets-v1';
const DEFAULT_PRESET_KEY = 'cbctscope-3d-default-v1';
interface Saved3dPreset {
  name: string;
  settings: Render3dSettings;
}
function loadSavedPresets(): Saved3dPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const arr = raw ? (JSON.parse(raw) as Saved3dPreset[]) : [];
    return Array.isArray(arr) ? arr.filter((p) => p && typeof p.name === 'string' && p.settings) : [];
  } catch {
    return [];
  }
}

function volLabel(v: ListEntry): string {
  const [c, r, n] = v.dims;
  const geom = v.kind === 'xray' ? `${c}×${r}px` : `${c}²×${n}`;
  return [`${v.fov[0]}×${v.fov[1]}cm`, geom, v.region || null, v.year || null]
    .filter(Boolean)
    .join(' · ');
}

export default function CbctApp() {
  const [volumes, setVolumes] = useState<ListEntry[]>([]);
  const [anon, setAnon] = useState<string | null>(null);
  const [meta, setMeta] = useState<CbctMeta | null>(null);
  const [controls, setControls] = useState<CbctControls>(defaultControls);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('mpr');
  const [histogram, setHistogram] = useState<HistogramData | null>(null);
  const [savedPresets, setSavedPresets] = useState<Saved3dPreset[]>([]);
  const [defaultPreset, setDefaultPreset] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');

  // saved 3D presets: load once; if one is marked default, start with it applied
  useEffect(() => {
    const presets = loadSavedPresets();
    setSavedPresets(presets);
    const def = localStorage.getItem(DEFAULT_PRESET_KEY);
    setDefaultPreset(def);
    const hit = def ? presets.find((p) => p.name === def) : null;
    if (hit) setControls((c) => ({ ...c, render3d: { ...DEFAULT_RENDER3D, ...hit.settings } }));
  }, []);

  // 📂 open source: native chooser, persisted server-side
  const [srcLabel, setSrcLabel] = useState<string | null>(null);
  const [srcNonce, setSrcNonce] = useState(0); // bump = refetch the volume list
  const [srcMenu, setSrcMenu] = useState(false);
  const [picking, setPicking] = useState(false);
  const srcMenuRef = useRef<HTMLDivElement | null>(null);
  const wantLocalRef = useRef(false); // after an open, jump to the first opened volume
  const wantSwitchRef = useRef<string | null>(null); // after a stitch, jump to the new fused volume
  useEffect(() => {
    fetch('/api/cbct/source')
      .then((r) => r.json())
      .then((d) => d.active && setSrcLabel(String(d.label)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!srcMenu) return;
    const onDown = (e: MouseEvent) => {
      if (srcMenuRef.current && !srcMenuRef.current.contains(e.target as Node)) setSrcMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [srcMenu]);

  const current = useMemo(() => volumes.find((v) => v.anon === anon) ?? null, [volumes, anon]);
  /** the open image is a single 2D radiograph — the volumetric modes don't apply */
  const isXray = current?.kind === 'xray';

  const ctPresetNames = useMemo(
    () => CONSTANTS.VIEWPORT_PRESETS.filter((p) => p.name.startsWith('CT-')).map((p) => p.name),
    [],
  );
  const r3d = controls.render3d;
  const styleDef = RENDER_STYLES[r3d.style]; // undefined ⇒ a CT-* preset: sliders don't apply
  const setR3d = useCallback((patch: Partial<Render3dSettings>) => {
    setControls((c) => ({ ...c, render3d: { ...c.render3d, ...patch } }));
  }, []);
  // picking a style loads that style's own defaults — projection persists
  const pickStyle = (style: string) => {
    const def = RENDER_STYLES[style];
    setControls((c) => ({
      ...c,
      render3d: def
        ? { ...DEFAULT_RENDER3D, style, threshold: def.defaultThreshold, perspective: c.render3d.perspective }
        : { ...c.render3d, style },
    }));
  };

  const persistPresets = (next: Saved3dPreset[]) => {
    setSavedPresets(next);
    try {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    } catch {
      /* storage full/blocked — presets just don't persist */
    }
  };
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    persistPresets([...savedPresets.filter((p) => p.name !== name), { name, settings: r3d }]);
    setPresetName('');
  };
  const deletePreset = (name: string) => {
    persistPresets(savedPresets.filter((p) => p.name !== name));
    if (defaultPreset === name) {
      setDefaultPreset(null);
      localStorage.removeItem(DEFAULT_PRESET_KEY);
    }
  };
  const toggleDefaultPreset = (name: string) => {
    const next = defaultPreset === name ? null : name;
    setDefaultPreset(next);
    if (next) localStorage.setItem(DEFAULT_PRESET_KEY, next);
    else localStorage.removeItem(DEFAULT_PRESET_KEY);
  };

  // anon mirror so switchVolume stays dep-free (the catalog effect depends on it; anon in its
  // deps would refetch the list on every volume change)
  const anonRef = useRef<string | null>(null);
  anonRef.current = anon;
  const switchVolume = useCallback((next: string | null) => {
    if (!next || next === anonRef.current) return;
    setError(null);
    setMeta(null);
    setHistogram(null);
    setControls((c) => ({ ...defaultControls, render3d: c.render3d })); // fresh state per volume
    setAnon(next);
  }, []);

  // volume list: opened local source + fused volumes + the built-in demo phantom (refetched
  // when the source changes — no-store so a just-registered volume is never masked by cache)
  useEffect(() => {
    fetch('/api/cbct', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const all: ListEntry[] = j.volumes ?? [];
        // fused (stitched) volumes first, then opened volumes, then the demo phantom
        const fused = all.filter((v) => isFusedVol(v.anon));
        const locals = all.filter((v) => isLocalVol(v.anon));
        const demo = all.filter((v) => isDemoVol(v.anon));
        const vols = [...fused, ...locals, ...demo];
        setVolumes(vols);
        if (wantSwitchRef.current && vols.some((v) => v.anon === wantSwitchRef.current)) {
          const target = wantSwitchRef.current;
          wantSwitchRef.current = null;
          switchVolume(target);
        } else if (wantLocalRef.current && locals.length) {
          wantLocalRef.current = false;
          switchVolume(locals[0].anon);
        } else if (vols.length) {
          const preferred = locals[0] ?? vols[0];
          setAnon((cur) => (cur && vols.some((v) => v.anon === cur) ? cur : preferred.anon));
        } else {
          setAnon(null);
        }
      })
      .catch(() => setError('volume catalog unavailable — is the server running?'));
  }, [srcNonce, switchVolume]);

  // point the viewer at a local CBCT export — via the native chooser (the server opens it
  // on this same machine)
  const onPickSource = useCallback(async (kind: 'folder' | 'file') => {
    setSrcMenu(false);
    setPicking(true);
    try {
      const r = await fetch('/api/cbct/source/pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const d = await r.json();
      if (d.canceled) return; // user dismissed the dialog — not an error
      if (!r.ok || d.error) return setError(String(d.error ?? `open failed (${r.status})`));
      setError(null);
      setSrcLabel(String(d.label));
      wantLocalRef.current = true;
      setSrcNonce((n) => n + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setPicking(false);
    }
  }, []);

  const onCloseSource = useCallback(async () => {
    setSrcMenu(false);
    try {
      await fetch('/api/cbct/source', { method: 'DELETE' });
    } catch {
      /* server gone — the refetch below will surface it */
    }
    setSrcLabel(null);
    setSrcNonce((n) => n + 1);
  }, []);

  // a stitch just produced a fused volume: refetch the catalog, jump to it, open it in MPR
  const onFused = useCallback((fusedAnon: string) => {
    wantSwitchRef.current = fusedAnon;
    setViewMode('mpr');
    setSrcNonce((n) => n + 1);
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!volumes.length || !anon) return;
      const i = volumes.findIndex((v) => v.anon === anon);
      switchVolume(volumes[(i + dir + volumes.length) % volumes.length].anon);
    },
    [volumes, anon, switchVolume],
  );

  // keyboard: N/P volume · 1..9,0 tools · R reset orientation · C plane lines · O overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'n') step(1);
      else if (k === 'p') step(-1);
      else if (k >= '0' && k <= '9') {
        const mode = TOOL_ORDER[k === '0' ? 9 : Number(k) - 1];
        if (mode) setControls((c) => ({ ...c, toolMode: mode }));
      } else if (k === 'r') setControls((c) => ({ ...c, resetNonce: c.resetNonce + 1 }));
      else if (k === 'c') setControls((c) => ({ ...c, planeLines: !c.planeLines }));
      else if (k === 'o') setControls((c) => ({ ...c, showOverlay: !c.showOverlay }));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  const setVoiPreset = (name: string) => {
    setControls((c) => ({ ...c, voi: WL_PRESETS[name] ?? null }));
  };
  const voiShown = controls.voi ?? meta?.defaultVoi ?? { center: 0, width: 1 };

  // ---- agent bridge: MCP-driven navigation/visualization (never findings) ----
  useAgentBridge({
    getState: () => ({
      volume: current
        ? {
            id: current.anon,
            label: current.label ?? null,
            kind: current.kind,
            dims: current.dims,
            spacingMm: current.spacing,
            fovCm: current.fov,
          }
        : null,
      viewMode,
      window: { center: voiShown.center, width: voiShown.width, auto: controls.voi === null },
      invert: controls.invert,
      tool: controls.toolMode,
    }),
    selectVolume: (id) => {
      if (!volumes.some((v) => v.anon === id)) return `unknown volume id: ${id}`;
      switchVolume(id);
      return null;
    },
    setViewMode: (mode) => {
      if (!VIEW_MODES.some(([m]) => m === mode)) {
        return `unknown view mode: ${mode} (valid: ${VIEW_MODES.map(([m]) => m).join(', ')})`;
      }
      if (isXray) return 'the open image is a 2D radiograph: view modes apply to CBCT volumes';
      setViewMode(mode as ViewMode);
      return null;
    },
    setWindow: ({ center, width, preset, invert }) => {
      if (preset !== undefined) {
        if (!(preset in WL_PRESETS)) return `unknown preset: ${preset} (valid: ${Object.keys(WL_PRESETS).join(', ')})`;
        if (isXray && preset !== 'Auto') {
          return `preset ${preset} is HU-based: a radiograph has no HU scale (use Auto, or center/width on the 0-4095 gray scale)`;
        }
        setControls((c) => ({ ...c, voi: WL_PRESETS[preset] ?? null }));
      } else if (center !== undefined || width !== undefined) {
        const cNum = Number(center ?? voiShown.center);
        const wNum = Number(width ?? voiShown.width);
        if (!Number.isFinite(cNum) || !Number.isFinite(wNum) || wNum < 1) return 'center/width must be numbers (width ≥ 1)';
        setControls((c) => ({ ...c, voi: { center: Math.round(cNum), width: Math.round(wNum) } }));
      }
      if (invert !== undefined) setControls((c) => ({ ...c, invert: !!invert }));
      return null;
    },
    resetView: (full) => {
      setControls((c) =>
        full
          ? { ...c, voi: null, invert: false, gamma: 1, fullResetNonce: c.fullResetNonce + 1 }
          : { ...c, resetNonce: c.resetNonce + 1 },
      );
      return null;
    },
  });

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent-dim)' : 'var(--panel-2)',
    color: 'var(--text)',
    fontSize: 12,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel)',
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 13 }}>CBCTScope</strong>
        <span
          title="This viewer is research software: it visualizes and navigates volumes and never produces findings or diagnoses. It is not a medical device."
          style={{
            fontSize: 11,
            color: 'var(--warn)',
            border: '1px solid var(--warn)',
            borderRadius: 6,
            padding: '2px 8px',
          }}
        >
          Research use only. Not for diagnosis.
        </span>
        {isXray ? (
          <span
            title="A single 2D radiograph is open — the volumetric reading modes apply to CBCT volumes"
            style={{
              fontSize: 12,
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '4px 10px',
              background: 'var(--accent-dim)',
            }}
          >
            2D radiograph
          </span>
        ) : (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {VIEW_MODES.map(([m, label, tip]) => (
              <button key={m} style={btn(viewMode === m)} title={tip} onClick={() => setViewMode(m)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <button style={btn(false)} onClick={() => step(-1)} title="Previous volume (P)">
          ‹
        </button>
        <select
          value={anon ?? ''}
          onChange={(e) => switchVolume(e.target.value)}
          style={{
            background: 'var(--panel-2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '4px 8px',
            maxWidth: 380,
          }}
        >
          {volumes.some((v) => isFusedVol(v.anon)) && (
            <optgroup label="🧬 stitched (this session)">
              {volumes
                .filter((v) => isFusedVol(v.anon))
                .map((v) => (
                  <option key={v.anon} value={v.anon}>
                    {v.label || v.anon.slice(6, 12)} — {volLabel(v)}
                  </option>
                ))}
            </optgroup>
          )}
          {volumes.some((v) => isLocalVol(v.anon)) && (
            <optgroup label={`📂 ${srcLabel ?? 'opened'}`}>
              {volumes
                .filter((v) => isLocalVol(v.anon))
                .map((v) => (
                  <option key={v.anon} value={v.anon}>
                    {v.label || v.anon.slice(6, 12)} — {volLabel(v)}
                  </option>
                ))}
            </optgroup>
          )}
          <optgroup label="built-in demo">
            {volumes
              .filter((v) => isDemoVol(v.anon))
              .map((v) => (
                <option key={v.anon} value={v.anon}>
                  {v.label || 'Synthetic phantom'} — {volLabel(v)}
                </option>
              ))}
          </optgroup>
        </select>
        <button style={btn(false)} onClick={() => step(1)} title="Next volume (N)">
          ›
        </button>
        {/* 📂 open a local CBCT export — DICOMDIR tree, slice-series folder, or multiframe file */}
        <div ref={srcMenuRef} style={{ position: 'relative' }}>
          <button
            style={{ ...btn(!!srcLabel), opacity: picking ? 0.5 : 1 }}
            disabled={picking}
            onClick={() => setSrcMenu((v) => !v)}
            title="Open a local CBCT export (folder, DICOMDIR, or DICOM file). Scans are read in place and never leave this computer."
          >
            {picking ? 'choosing…' : srcLabel ? `📂 ${srcLabel} ▾` : '📂 open ▾'}
          </button>
          {srcMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                zIndex: 50,
                marginTop: 2,
                minWidth: 250,
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                padding: 4,
              }}
            >
              <button className="menu-item" onClick={() => void onPickSource('folder')}>
                📁 Open folder / DICOMDIR…
              </button>
              <button
                className="menu-item"
                title="One DICOMDIR, one multiframe volume, or one slice (opens its whole series)"
                onClick={() => void onPickSource('file')}
              >
                🗄 Open DICOM file…
              </button>
              {srcLabel && (
                <>
                  <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                  <button className="menu-item" onClick={() => void onCloseSource()}>
                    ✕ Close 📂 {srcLabel}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {current && (
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            {isFusedVol(current.anon) && current.label ? `🧬 ${current.label} · ` : isLocalVol(current.anon) && current.label ? `📂 ${current.label} · ` : ''}
            {volLabel(current)} ·{' '}
            {current.kind === 'mf' ? 'multiframe' : current.kind === 'xray' ? 'radiograph' : 'slices'} ·{' '}
            {(current.spacing[0] * 1000).toFixed(0)} µm {current.kind === 'xray' ? 'pixels' : 'voxels'}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          {isXray
            ? 'wheel: zoom · left-drag: pan · double-click / R: fit · N/P'
            : `wheel: slice · left: ${controls.toolMode} · right-drag: rotate section · ⇧right-drag: zoom · middle-drag: pan · N/P · R · C · O · V · Del`}
        </span>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <main style={{ flex: 1, minWidth: 0, padding: 8 }}>
          {error ? (
            <div style={{ color: 'var(--warn)', padding: 24 }}>{error}</div>
          ) : anon ? (
            isXray ? (
              <CbctRadiograph
                anon={anon}
                voi={controls.voi}
                invert={controls.invert}
                gamma={controls.gamma}
                resetNonce={controls.resetNonce}
                fullResetNonce={controls.fullResetNonce}
                onMeta={setMeta}
                onHistogram={setHistogram}
                onError={setError}
              />
            ) : viewMode === 'mpr' ? (
              <CbctViewport
                anon={anon}
                controls={controls}
                onMeta={setMeta}
                onHistogram={setHistogram}
                onError={setError}
                onControlsPatch={(p) => setControls((c) => ({ ...c, ...p }))}
              />
            ) : viewMode === 'grid' ? (
              <CbctGrid
                anon={anon}
                voi={controls.voi}
                invert={controls.invert}
                gamma={controls.gamma}
                onMeta={setMeta}
                onError={setError}
              />
            ) : viewMode === 'tmj' ? (
              <CbctTmj
                anon={anon}
                voi={controls.voi}
                invert={controls.invert}
                onMeta={setMeta}
                onError={setError}
              />
            ) : viewMode === 'reslice' ? (
              <CbctReslice
                anon={anon}
                voi={controls.voi}
                invert={controls.invert}
                onMeta={setMeta}
                onError={setError}
              />
            ) : viewMode === 'ceph' ? (
              <CbctCeph
                anon={anon}
                voi={controls.voi}
                invert={controls.invert}
                onMeta={setMeta}
                onError={setError}
              />
            ) : viewMode === 'region' ? (
              <CbctRegion
                anon={anon}
                voi={controls.voi}
                invert={controls.invert}
                onMeta={setMeta}
                onError={setError}
              />
            ) : viewMode === 'stitch' ? (
              <CbctStitch
                anon={anon}
                voi={controls.voi}
                invert={controls.invert}
                volumes={volumes.filter((v) => v.kind !== 'xray')}
                onFused={onFused}
                onMeta={setMeta}
                onError={setError}
              />
            ) : (
              <CbctPano
                anon={anon}
                voi={controls.voi}
                invert={controls.invert}
                onMeta={setMeta}
                onError={setError}
              />
            )
          ) : (
            <div style={{ color: 'var(--text-dim)', padding: 24 }}>no volumes available</div>
          )}
        </main>

        <aside
          style={{
            width: 240,
            borderLeft: '1px solid var(--border)',
            background: 'var(--panel)',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            overflowY: 'auto',
          }}
        >
          {viewMode === 'mpr' && !isXray && (
          <section>
            <div style={{ color: 'var(--text-dim)', marginBottom: 6 }}>Tool (1–9, 0)</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TOOL_ORDER.map((m, i) => (
                <button
                  key={m}
                  style={btn(controls.toolMode === m)}
                  onClick={() => setControls((c) => ({ ...c, toolMode: m }))}
                  title={`${TOOL_LABEL[m]} (${(i + 1) % 10})`}
                >
                  {TOOL_LABEL[m]}
                </button>
              ))}
            </div>
            {controls.toolMode === 'roi3d' && (
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
                box depth {controls.roi3dDepth} mm (into the slice, centered on it)
                <input
                  type="range"
                  min={1}
                  max={60}
                  step={1}
                  value={controls.roi3dDepth}
                  onChange={(e) => setControls((c) => ({ ...c, roi3dDepth: Number(e.target.value) }))}
                  onDoubleClick={() => setControls((c) => ({ ...c, roi3dDepth: 10 }))}
                  title="drag a rectangle on any slice pane; the box extends this many mm through the slice — double-click resets to 10"
                  style={{ width: '100%' }}
                />
              </label>
            )}
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.5 }}>
              arrow/text prompt for a label · rect/ellipse report density (HU) stats · freehand:
              open stroke = curved-path mm, closed loop = region stats · 3D ROI: drag a box, get
              volume + density stats · Del deletes the selected object
            </div>
          </section>
          )}

          <section>
            <div style={{ color: 'var(--text-dim)', marginBottom: 6 }}>
              Window {isXray ? '(gray, 0-4095)' : '(HU)'}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {Object.keys(WL_PRESETS)
                .filter((name) => !isXray || WL_PRESETS[name] === null) // HU presets are meaningless on a radiograph
                .map((name) => {
                const p = WL_PRESETS[name];
                const active = p
                  ? controls.voi?.center === p.center && controls.voi?.width === p.width
                  : controls.voi === null;
                return (
                  <button key={name} style={btn(active)} onClick={() => setVoiPreset(name)}>
                    {name}
                  </button>
                );
              })}
            </div>
            {histogram && (
              <div style={{ marginBottom: 8 }}>
                <CbctHistogram
                  data={histogram}
                  unit={isXray ? 'gray' : 'HU'}
                  lower={Math.round(voiShown.center - voiShown.width / 2)}
                  upper={Math.round(voiShown.center + voiShown.width / 2)}
                  onChange={(lower, upper) =>
                    setControls((c) => ({
                      ...c,
                      voi: { center: Math.round((lower + upper) / 2), width: Math.max(10, upper - lower) },
                    }))
                  }
                />
              </div>
            )}
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
              center {voiShown.center}
              <input
                type="range"
                min={isXray ? 0 : -1000}
                max={isXray ? 4095 : 3000}
                step={10}
                value={voiShown.center}
                onChange={(e) =>
                  setControls((c) => ({
                    ...c,
                    voi: { center: Number(e.target.value), width: voiShown.width },
                  }))
                }
                style={{ width: '100%' }}
              />
            </label>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
              width {voiShown.width}
              <input
                type="range"
                min={50}
                max={isXray ? 4096 : 4500}
                step={10}
                value={voiShown.width}
                onChange={(e) =>
                  setControls((c) => ({
                    ...c,
                    voi: { center: voiShown.center, width: Number(e.target.value) },
                  }))
                }
                style={{ width: '100%' }}
              />
            </label>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
              gamma {controls.gamma.toFixed(2)} (curve between the cut points; 1 = linear)
              <input
                type="range"
                min={0.3}
                max={3}
                step={0.05}
                value={controls.gamma}
                onChange={(e) => setControls((c) => ({ ...c, gamma: Number(e.target.value) }))}
                onDoubleClick={() => setControls((c) => ({ ...c, gamma: 1 }))}
                title="display gamma — double-click to reset to 1"
                style={{ width: '100%' }}
              />
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 4 }}>
              <input
                type="checkbox"
                checked={controls.invert}
                onChange={(e) => setControls((c) => ({ ...c, invert: e.target.checked }))}
              />
              invert
            </label>
          </section>

          {viewMode === 'mpr' && !isXray && (
          <section>
            <div style={{ color: 'var(--text-dim)', marginBottom: 6 }}>Slab / MIP</div>
            {(['axial', 'sagittal', 'coronal'] as MprPane[]).map((p) => (
              <label key={p} style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                {p} {controls.slabByPane[p].toFixed(1)} mm
                <input
                  type="range"
                  min={0.1}
                  max={20}
                  step={0.1}
                  value={controls.slabByPane[p]}
                  onChange={(e) =>
                    setControls((c) => ({
                      ...c,
                      slabByPane: { ...c.slabByPane, [p]: Number(e.target.value) },
                    }))
                  }
                  style={{ width: '100%' }}
                />
              </label>
            ))}
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 4 }}>
              <input
                type="checkbox"
                checked={controls.mip}
                onChange={(e) => setControls((c) => ({ ...c, mip: e.target.checked }))}
              />
              MIP (brightest voxel across the slab)
            </label>
          </section>
          )}

          {viewMode === 'mpr' && !isXray && (
          <section>
            <div style={{ color: 'var(--text-dim)', marginBottom: 6 }}>3D render</div>
            <select
              value={r3d.style}
              onChange={(e) => pickStyle(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--panel-2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '4px 8px',
                marginBottom: 8,
              }}
            >
              <optgroup label="Styles">
                {Object.entries(RENDER_STYLES)
                  .filter(([, d]) => d.group === 'classic')
                  .map(([value, d]) => (
                    <option key={value} value={value} title={d.tip}>
                      {d.label}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="CBCT tuned">
                {Object.entries(RENDER_STYLES)
                  .filter(([, d]) => d.group === 'cbct')
                  .map(([value, d]) => (
                    <option key={value} value={value} title={d.tip}>
                      {d.label}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Generic CT presets (no adjust)">
                {ctPresetNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </optgroup>
            </select>
            {styleDef ? (
              <>
                {histogram && (
                  <div style={{ marginBottom: 6 }}>
                    <CbctHistogram
                      data={histogram}
                      threshold={r3d.threshold}
                      onThreshold={(hu) => setR3d({ threshold: hu })}
                    />
                  </div>
                )}
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                  opacity threshold {r3d.threshold} HU (densities below stay transparent)
                  <input
                    type="range"
                    min={-1000}
                    max={3000}
                    step={10}
                    value={r3d.threshold}
                    onChange={(e) => setR3d({ threshold: Number(e.target.value) })}
                    onDoubleClick={() => setR3d({ threshold: styleDef.defaultThreshold })}
                    title="double-click: back to the style's default"
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                  transparency {r3d.transparency}%
                  <input
                    type="range"
                    min={0}
                    max={90}
                    step={1}
                    value={r3d.transparency}
                    onChange={(e) => setR3d({ transparency: Number(e.target.value) })}
                    onDoubleClick={() => setR3d({ transparency: 0 })}
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                  contrast {r3d.contrast}
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    step={1}
                    value={r3d.contrast}
                    onChange={(e) => setR3d({ contrast: Number(e.target.value) })}
                    onDoubleClick={() => setR3d({ contrast: 0 })}
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                  brightness {r3d.brightness}
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    step={1}
                    value={r3d.brightness}
                    onChange={(e) => setR3d({ brightness: Number(e.target.value) })}
                    onDoubleClick={() => setR3d({ brightness: 0 })}
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, margin: '4px 0' }}>
                  pseudo-color
                  <select
                    value={r3d.pseudo}
                    onChange={(e) => setR3d({ pseudo: e.target.value as PseudoKey })}
                    style={{
                      flex: 1,
                      background: 'var(--panel-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '2px 6px',
                    }}
                  >
                    {(['none', 'hot', 'cool', 'rainbow'] as PseudoKey[]).map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                  edge emphasis {r3d.edgeEmphasis} (flat interiors fade, surfaces pop)
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={r3d.edgeEmphasis}
                    onChange={(e) => setR3d({ edgeEmphasis: Number(e.target.value) })}
                    onDoubleClick={() => setR3d({ edgeEmphasis: 0 })}
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, margin: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={r3d.lightFollow}
                    onChange={(e) => setR3d({ lightFollow: e.target.checked })}
                  />
                  light follows the camera (uncheck for a fixed light direction)
                </label>
                {!r3d.lightFollow && (
                  <>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                      light around {r3d.lightAz}° (0 = from the front)
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={5}
                        value={r3d.lightAz}
                        onChange={(e) => setR3d({ lightAz: Number(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                      light height {r3d.lightEl}° (+ = from above)
                      <input
                        type="range"
                        min={-80}
                        max={80}
                        step={5}
                        value={r3d.lightEl}
                        onChange={(e) => setR3d({ lightEl: Number(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </>
                )}
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, margin: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={r3d.skinShell}
                    onChange={(e) => setR3d({ skinShell: e.target.checked })}
                  />
                  skin shell (flesh-toned surface below the opacity threshold)
                </label>
                {r3d.skinShell && (
                  <>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                      shell threshold {r3d.skinShellThreshold} HU
                      <input
                        type="range"
                        min={-800}
                        max={200}
                        step={10}
                        value={r3d.skinShellThreshold}
                        onChange={(e) => setR3d({ skinShellThreshold: Number(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                      shell opacity {r3d.skinShellOpacity}%
                      <input
                        type="range"
                        min={5}
                        max={80}
                        step={1}
                        value={r3d.skinShellOpacity}
                        onChange={(e) => setR3d({ skinShellOpacity: Number(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </>
                )}
              </>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
                generic CT preset — applied as-is, the adjust sliders work on the named styles above
              </div>
            )}
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 2 }}>
              <input
                type="checkbox"
                checked={r3d.perspective}
                onChange={(e) => setR3d({ perspective: e.target.checked })}
              />
              perspective projection (off = orthographic; toggling re-homes the 3D camera)
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 6 }}>
              <input
                type="checkbox"
                checked={controls.planes3d}
                onChange={(e) => setControls((c) => ({ ...c, planes3d: e.target.checked }))}
              />
              plane indicators — the three section planes + bounding box inside the render
            </label>
          </section>
          )}

          {viewMode === 'mpr' && !isXray && (
          <section>
            <div style={{ color: 'var(--text-dim)', marginBottom: 6 }}>
              Crop 3D <span style={{ fontSize: 10 }}>(render only — slices unaffected)</span>
            </div>
            {(
              [
                ['x', 'R → L'],
                ['y', 'A → P'],
                ['z', 'I → S'],
              ] as [keyof Crop3d, string][]
            ).map(([axis, label]) => (
              <div key={axis} style={{ marginBottom: 2 }}>
                <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {label} · keep {Math.round(controls.crop3d[axis][0] * 100)}–
                  {Math.round(controls.crop3d[axis][1] * 100)}%
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([0, 1] as const).map((idx) => (
                    <input
                      key={idx}
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(controls.crop3d[axis][idx] * 100)}
                      onChange={(e) => {
                        const v = Number(e.target.value) / 100;
                        setControls((c) => {
                          const pair: [number, number] = [...c.crop3d[axis]];
                          // the two thumbs can't cross — keep ≥2% of the axis
                          pair[idx] = idx === 0 ? Math.min(v, pair[1] - 0.02) : Math.max(v, pair[0] + 0.02);
                          return { ...c, crop3d: { ...c.crop3d, [axis]: pair } };
                        });
                      }}
                      title={idx === 0 ? `crop from the ${label.split(' ')[0]} side` : `crop from the ${label.split(' ')[2]} side`}
                      style={{ flex: 1 }}
                    />
                  ))}
                </div>
              </div>
            ))}
            <button
              style={{ ...btn(false), width: '100%', marginTop: 6 }}
              onClick={() =>
                setControls((c) => ({
                  ...c,
                  crop3d: { x: [0, 1], y: [0, 1], z: [0, 1] },
                  clearCutsNonce: c.clearCutsNonce + 1,
                }))
              }
              title="full volume back in the render: crop box reset + every ⇧right-drag cut removed"
            >
              Un-crop + clear cuts
            </button>
          </section>
          )}

          {viewMode === 'mpr' && !isXray && (
          <section>
            <div style={{ color: 'var(--text-dim)', marginBottom: 6 }}>My 3D presets</div>
            {savedPresets.map((p) => (
              <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <button
                  style={{ ...btn(false), flex: 1, textAlign: 'left' }}
                  onClick={() => setControls((c) => ({ ...c, render3d: { ...DEFAULT_RENDER3D, ...p.settings } }))}
                  title="apply this saved style"
                >
                  {p.name}
                </button>
                <button
                  onClick={() => toggleDefaultPreset(p.name)}
                  title={defaultPreset === p.name ? 'default on app start — click to unset' : 'set as the default on app start'}
                  style={{
                    ...btn(defaultPreset === p.name),
                    padding: '4px 7px',
                    color: defaultPreset === p.name ? '#ffd54a' : 'var(--text)',
                  }}
                >
                  ★
                </button>
                <button
                  onClick={() => deletePreset(p.name)}
                  title="delete this saved style"
                  style={{ ...btn(false), padding: '4px 7px' }}
                >
                  ✕
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') savePreset();
                }}
                placeholder="name current look…"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '4px 8px',
                  fontSize: 12,
                  color: 'var(--text)',
                }}
              />
              <button style={btn(false)} onClick={savePreset} disabled={!presetName.trim()}>
                Save
              </button>
            </div>
          </section>
          )}

          {viewMode === 'mpr' && !isXray && (
          <section>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={controls.planeLines}
                onChange={(e) => setControls((c) => ({ ...c, planeLines: e.target.checked }))}
              />
              plane lines (C) — synced on all three views
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={controls.showOverlay}
                onChange={(e) => setControls((c) => ({ ...c, showOverlay: e.target.checked }))}
              />
              show overlays (O) — lines, measurements, labels
            </label>
            <button
              style={{ ...btn(false), width: '100%', marginBottom: 6 }}
              onClick={() => setControls((c) => ({ ...c, resetNonce: c.resetNonce + 1 }))}
              title="Cameras back to orthogonal — window and everything else untouched (R)"
            >
              Reset orientation (R)
            </button>
            <button
              style={{ ...btn(false), width: '100%' }}
              onClick={() =>
                setControls((c) => ({
                  ...c,
                  voi: null,
                  invert: false,
                  gamma: 1,
                  fullResetNonce: c.fullResetNonce + 1,
                }))
              }
              title="Reset cameras AND window/gamma back to the volume's defaults"
            >
              Reset all (window too)
            </button>
          </section>
          )}

          {isXray && (
            <section>
              <button
                style={{ ...btn(false), width: '100%', marginBottom: 6 }}
                onClick={() => setControls((c) => ({ ...c, resetNonce: c.resetNonce + 1 }))}
                title="Fit the radiograph to the pane — window untouched (R)"
              >
                Fit to pane (R)
              </button>
              <button
                style={{ ...btn(false), width: '100%' }}
                onClick={() =>
                  setControls((c) => ({
                    ...c,
                    voi: null,
                    invert: false,
                    gamma: 1,
                    fullResetNonce: c.fullResetNonce + 1,
                  }))
                }
                title="Fit AND window/gamma back to the image's defaults"
              >
                Reset all (window too)
              </button>
            </section>
          )}

          <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            {isXray
              ? 'Radiograph: wheel zooms about the cursor · left-drag pans · double-click or R refits. Gray values are display-normalized (0-4095): window them via the histogram or sliders; they are not HU.'
              : 'Measurements are true anatomical mm (isotropic voxels) — unlike pano mm, no projection magnification. Crosshairs: drag the lines to re-slice; wheel scrolls the hovered pane.'}
          </div>
        </aside>
      </div>
    </div>
  );
}
