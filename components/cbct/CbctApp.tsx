'use client';
// CBCT reading app — the client shell. Owns all control state and the volume picker;
// CbctViewport (keyed by volume id, so switching = clean remount) does the rendering.
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import CbctViewport, {
  type CbctControls,
  type CbctMeta,
  type CbctToolMode,
  type Crop3d,
  type HistogramData,
  type MprPane,
} from './CbctViewport';
import { RENDER_STYLES, DEFAULT_RENDER3D, AIR_PRESET, migrateRender3d, type Render3dSettings, type PseudoKey } from './render3d';
import CbctPano from './CbctPano';
import CbctGrid from './CbctGrid';
import CbctRadiograph from './CbctRadiograph';
import CbctHistogram from './CbctHistogram';
import { announceShown, loadVolumeData, onVolumeShown } from './volumeData';
import OpenProgressPanel, { type OpenPanelState } from './OpenProgressPanel';
import { computeHistogram } from './CbctViewport';
import ExportMenu from './ExportMenu';
import CbctTmj from './CbctTmj';
import CbctReslice from './CbctReslice';
import CbctCeph from './CbctCeph';
import CbctRegion from './CbctRegion';
import CbctStitch from './CbctStitch';
import { useAgentBridge } from './useAgentBridge';
import { agentTransport } from './agentChannel';
import AgentPanel, { AgentToggle } from './agent/AgentPanel';
import ManualDrawer, { guidePage, manualHref } from './ManualDrawer';
import { AGENT_AVAILABLE, IS_DESKTOP } from './shell';
import { IS_WEB, isCanceled, source } from './source';
import { EVIDENCE_SCHEMA, parseMarksFile, type EvidenceFile } from './evidence';
import { SIZE_NOTICE_MIB, needsSizeNotice, voxelBytes } from './sizeNotice';
import { dropLabel, entriesOf, walkDrop } from './dropFiles';
import { selectVolumeVerb, type SwitchOutcome } from './agentSelect';
import { useDropOverlay } from './useDropOverlay';
import { isChord } from './keys';
import { downloadBlob } from './exporters';
import {
  ResearchUseDialog,
  SizeNoticeDialog,
  acknowledgeResearch,
  researchAcknowledged,
} from './WebDialogs';
import AboutBadge from '@/components/AboutBadge';
import SnapshotButton, { type SnapRef } from './SnapshotButton';
import { BookOpen, FolderOpen, Keyboard } from 'lucide-react';

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

// The web build's header links to the repository (docs/web-build.md, section 7). A link the
// reader clicks, never a request the page makes; tests/noAbsoluteUrls.test.ts knows both.
const REPO_URL = 'https://github.com/rezamotaghi/cbctscope';
const RELEASES_URL = 'https://github.com/rezamotaghi/cbctscope/releases';
const noSubscribe = () => () => {};
const VIEW_MODES: [ViewMode, string, string][] = [
  ['mpr', 'MPR', 'orthogonal slices + 3D render'],
  ['grid', 'Grid', 'many parallel slices on one screen'],
  ['pano', 'Pano', 'curved panoramic + cross-sections'],
  ['tmj', 'TMJ', 'both condyles in axis-corrected sections'],
  ['reslice', 'Reslice', 'new slice stack along any drawn line or curve'],
  ['ceph', 'Ceph', 'virtual cephalogram: the volume projected flat like a film'],
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
// One gesture legend per room — the header used to show the MPR text over every mode,
// describing gestures the other rooms don't have. MPR's stays tool-aware; the universal
// "dbl-click a slider = reset" tail is appended for all.
const MODE_LEGEND: Record<ViewMode, (tool: string) => string> = {
  mpr: (tool) => `Wheel: slice. Left: ${tool}. Right-drag rotates the section, right and left drag zooms, middle-drag pans.`,
  grid: () => 'Scout: left-drag moves the window, right-drag rotates. Tiles: wheel steps, right-drag rotates in-plane.',
  pano: () => 'Axial: a stroke draws the arch, the wheel moves the slice. Pano: click or wheel moves the sections. Sections: right-drag tilts.',
  tmj: () => 'Axial: drag an axis line per side, right-click deletes, the wheel moves the slice. Tiles: right-drag tilts the fan.',
  reslice: () => 'Scout: drag a line, or click dots and double-click to finish; the wheel moves the slice. Tiles: right-drag tilts.',
  ceph: () => 'Drag the image: horizontal turns (yaw), vertical nods (pitch). Projection presets are in the toolbar.',
  region: () => 'Axial: drag a box, click a seed, the wheel moves the slice. Right of the planes: the vertical-range handles.',
  stitch: () => 'Pick volume B, auto align, then fine-tune the sliders. In the color overlay, fringes show misalignment.',
};

// 'wl' rides at the END so the 1-9/0 number keys keep their historical meaning — it gets
// its own key (W) instead of renumbering ten muscle-memory bindings.
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
  'wl',
] as const;
const TOOL_KEY = (m: CbctToolMode, i: number): string => (m === 'wl' ? 'W' : String((i + 1) % 10));
const TOOL_LABEL: Record<CbctToolMode, string> = {
  crosshairs: 'Crosshairs',
  pan: 'Pan',
  wl: 'W/L',
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
    return Array.isArray(arr)
      ? arr
          .filter((p) => p && typeof p.name === 'string' && p.settings)
          .map((p) => ({ ...p, settings: migrateRender3d(p.settings) }))
      : [];
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
  const [keysOpen, setKeysOpen] = useState(false);
  // the ONE snapshot button (header): the active room registers its composer here —
  // same button, same place, every room
  const snapRef: SnapRef = useRef<(() => void) | null>(null);
  const [histogram, setHistogram] = useState<HistogramData | null>(null);
  const [savedPresets, setSavedPresets] = useState<Saved3dPreset[]>([]);
  const [defaultPreset, setDefaultPreset] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  /** a newer viewer tab took over the agent connection (single-viewer contract) */
  const [agentEvicted, setAgentEvicted] = useState(false);

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
  /** the header's help menu: this mode's reading guide and the user manual */
  const [helpMenu, setHelpMenu] = useState(false);
  /** the manual page the help drawer shows, or null when it is closed (repo build and desktop app) */
  const [manualPage, setManualPage] = useState<string | null>(null);
  const helpMenuRef = useRef<HTMLDivElement | null>(null);
  const [picking, setPicking] = useState(false);
  const srcMenuRef = useRef<HTMLDivElement | null>(null);
  const wantLocalRef = useRef(false); // after an open, jump to the first opened volume
  const wantSwitchRef = useRef<string | null>(null); // after a stitch, jump to the new fused volume
  // web build: the size notice holds a volume back until the reader continues; the
  // research-use dialogue opens on the first real open in this browser profile; a load of
  // marks unmounts the room while the sidecar is replaced, then remounts it
  const [pendingSize, setPendingSize] = useState<{ anon: string; label: string; bytes: number } | null>(null);
  const [researchOpen, setResearchOpen] = useState(false);
  const [marksBusy, setMarksBusy] = useState(false);
  /** web build: the open's progress panel, from the files handed over to the first frame */
  const [openPanel, setOpenPanel] = useState<OpenPanelState | null>(null);
  const openTokenRef = useRef(0); // reports from an earlier open are ignored
  const finishOpen = useCallback(() => setOpenPanel((p) => (p?.kind === 'busy' ? null : p)), []);
  /** start the panel for a files open; returns the token its reports must carry */
  const beginOpen = useCallback((total?: number) => {
    const token = ++openTokenRef.current;
    setOpenPanel({ kind: 'busy', phase: 'scan', done: 0, total, startedAt: Date.now() });
    return token;
  }, []);
  useEffect(() => onVolumeShown((shown) => isLocalVol(shown) && finishOpen()), [finishOpen]);
  // the CPU rooms (and the radiograph) draw in the task that reports their meta: the next
  // frame shows it. The MPR viewport announces its own first frame after the GPU render.
  const onRoomMeta = useCallback((m: CbctMeta) => {
    setMeta(m);
    requestAnimationFrame(() => announceShown(m.anon));
  }, []);
  useEffect(() => {
    if (error) finishOpen(); // a failed load ends the open; the error shows in its place
  }, [error, finishOpen]);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const marksInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    // React has no typed prop for the directory picker; set the attribute by hand
    folderInputRef.current?.setAttribute('webkitdirectory', '');
  }, []);
  useEffect(() => {
    source
      .opened()
      .then((o) => o && setSrcLabel(o.label))
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
  useEffect(() => {
    if (!helpMenu) return;
    const onDown = (e: MouseEvent) => {
      if (helpMenuRef.current && !helpMenuRef.current.contains(e.target as Node)) setHelpMenu(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [helpMenu]);

  const current = useMemo(() => volumes.find((v) => v.anon === anon) ?? null, [volumes, anon]);
  /** the open image is a single 2D radiograph — the volumetric modes don't apply */
  const isXray = current?.kind === 'xray';

  const r3d = controls.render3d;
  const styleDef = RENDER_STYLES[r3d.style]; // undefined means the Air preset: the sliders don't apply
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
  // catalog mirror for the size gate (the catalog effect sets it before it switches)
  const volumesRef = useRef<ListEntry[]>([]);
  volumesRef.current = volumes;
  /** web build: hold a large volume back behind the size notice; true = held */
  const sizeHeld = useCallback((next: string): boolean => {
    if (!IS_WEB) return false;
    const v = volumesRef.current.find((e) => e.anon === next);
    if (!v) return false;
    const bytes = voxelBytes(v.dims);
    if (!needsSizeNotice(bytes, SIZE_NOTICE_MIB)) return false;
    setPendingSize({ anon: next, label: v.label || (isDemoVol(next) ? 'Synthetic phantom' : next), bytes });
    return true;
  }, []);
  const switchVolume = useCallback((next: string | null, confirmed = false): SwitchOutcome => {
    if (!next || next === anonRef.current) return 'same';
    if (!confirmed && sizeHeld(next)) return 'held';
    setError(null);
    setMeta(null);
    setHistogram(null);
    setControls((c) => ({ ...defaultControls, render3d: c.render3d })); // fresh state per volume
    setAnon(next);
    return 'switched';
  }, [sizeHeld]);

  // volume list: fused volumes, then the opened source, then the built-in demo phantom, in
  // the source's order (refetched when the source changes)
  useEffect(() => {
    source
      .list()
      .then((vols) => {
        const locals = vols.filter((v) => isLocalVol(v.anon));
        volumesRef.current = vols;
        setVolumes(vols);
        if (wantSwitchRef.current && vols.some((v) => v.anon === wantSwitchRef.current)) {
          const target = wantSwitchRef.current;
          wantSwitchRef.current = null;
          switchVolume(target);
        } else if (wantLocalRef.current && locals.length) {
          wantLocalRef.current = false;
          // the same export opened again is already on screen: nothing loads, the open is done
          if (locals[0].anon === anonRef.current) finishOpen();
          switchVolume(locals[0].anon);
        } else if (vols.length) {
          const preferred = locals[0] ?? vols[0];
          const cur = anonRef.current;
          if (cur && vols.some((v) => v.anon === cur)) {
            /* keep the volume on screen */
          } else if (sizeHeld(preferred.anon)) setAnon(null);
          else setAnon(preferred.anon);
        } else {
          setAnon(null);
        }
      })
      .catch(() =>
        setError(IS_WEB ? 'volume catalog unavailable: reload the page' : 'volume catalog unavailable: is the server running?'),
      );
  }, [srcNonce, switchVolume, sizeHeld, finishOpen]);

  // point the viewer at a local CBCT export. The local app: the native chooser (the server
  // opens it in place on this same machine). The web build: files from the picker or a drop,
  // read into this tab.
  const openWith = useCallback(async (input: Parameters<typeof source.open>[0], started?: number) => {
    setSrcMenu(false);
    setPicking(true);
    // files (the web build) get the progress panel; the native chooser has its own dialog
    const token = input.kind === 'files' ? (started ?? beginOpen(input.files.length)) : null;
    const live = () => token !== null && openTokenRef.current === token;
    try {
      const r = await source.open(
        input,
        token === null
          ? undefined
          : (p) => live() && setOpenPanel((cur) => (cur?.kind === 'busy' ? { ...cur, ...p } : cur)),
      );
      if (isCanceled(r)) return; // the reader dismissed the dialog: not an error
      if (!r.ok) {
        if (live() && r.scanned !== undefined) {
          return setOpenPanel({ kind: 'none', error: r.error, reasons: r.reasons ?? [], headline: r.headline });
        }
        if (live()) setOpenPanel(null);
        return setError(r.error);
      }
      setError(null);
      setSrcLabel(r.label);
      wantLocalRef.current = true;
      setSrcNonce((n) => n + 1);
      if (IS_WEB && !researchAcknowledged()) setResearchOpen(true);
    } catch (e) {
      if (live()) setOpenPanel(null);
      setError(String(e));
    } finally {
      setPicking(false);
    }
  }, [beginOpen]);
  const onPickSource = useCallback(
    (kind: 'folder' | 'file') => openWith({ kind: 'native', chooser: kind }),
    [openWith],
  );
  const onFilesChosen = useCallback(
    (list: FileList | null) => {
      const files = list ? Array.from(list) : [];
      if (!files.length) return; // the picker was dismissed
      const first = files[0];
      const label = first.webkitRelativePath ? first.webkitRelativePath.split('/')[0] : first.name;
      void openWith({ kind: 'files', files, label });
    },
    [openWith],
  );
  const onDropFiles = useCallback(
    async (dt: DataTransfer) => {
      const entries = entriesOf(dt); // synchronous: the items die after the drop handler
      if (!entries.length) return;
      const token = beginOpen(); // the panel shows while the drop is walked, before the count is known
      try {
        const { files, stopped } = await walkDrop(entries);
        if (files.length) await openWith({ kind: 'files', files, label: dropLabel(entries), ...(stopped ? { walkStopped: stopped } : {}) }, token);
        else if (openTokenRef.current === token) setOpenPanel(null);
      } catch (e) {
        if (openTokenRef.current === token) setOpenPanel(null);
        setError(`could not read the dropped files: ${String(e)}`);
      }
    },
    [openWith, beginOpen],
  );
  const drop = useDropOverlay(IS_WEB, (dt) => void onDropFiles(dt));

  const onCloseSource = useCallback(async () => {
    setSrcMenu(false);
    await source.close(); // never throws: a gone server surfaces in the refetch below
    setSrcLabel(null);
    setSrcNonce((n) => n + 1);
  }, []);

  // web build: marks travel as a JSON file (the sidecar of the volume on screen)
  const onSaveMarks = useCallback(async () => {
    setSrcMenu(false);
    if (!anon) return;
    const ev: EvidenceFile = (await source.getEvidence(anon)) ?? {
      schema: EVIDENCE_SCHEMA,
      anon,
      saved_at: new Date().toISOString(),
      annotations: [],
      views: [],
      rois3d: [],
    };
    downloadBlob(new Blob([JSON.stringify(ev, null, 2)], { type: 'application/json' }), `${anon}_marks.json`);
  }, [anon]);
  const onLoadMarks = useCallback(
    async (list: FileList | null) => {
      const f = list?.[0];
      if (!f || !anon) return;
      const parsed = parseMarksFile(await f.text(), anon);
      if ('error' in parsed) return setError(parsed.error);
      if (parsed.dropped) {
        setError(
          `${parsed.dropped} ${parsed.dropped === 1 ? 'entry' : 'entries'} of that marks file failed validation and ${parsed.dropped === 1 ? 'was' : 'were'} left out; the rest loaded.`,
        );
      }
      // unmount the room first so its own autosave cannot write the old marks back
      setMarksBusy(true);
      try {
        await new Promise((r) => setTimeout(r, 50));
        if (!(await source.putEvidence(parsed.file))) setError('the marks could not be stored in this browser');
      } finally {
        setMarksBusy(false);
      }
    },
    [anon],
  );

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

  // Histogram at volume load: rides the active pane's own loadVolumeData via the
  // in-flight/cache dedupe, so every room gets the sidebar histogram without visiting
  // MPR first. MPR's onHistogram stays as belt-and-suspenders (identical data).
  useEffect(() => {
    if (!anon) return;
    let stale = false;
    loadVolumeData(anon)
      .then((e) => !stale && setHistogram(computeHistogram(e.scalar)))
      .catch(() => {
        /* the pane's own loader reports the failure */
      });
    return () => {
      stale = true;
    };
  }, [anon]);

  // keyboard: N/P volume · 1..9,0 tools · R reset orientation · C plane lines · O overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      // Cmd, Ctrl or Alt held: the chord belongs to the browser or the app menu (open, close,
      // reload, copy, new window, print, tab switching), never to a viewer key
      if (isChord(e)) return;
      const k = e.key.toLowerCase();
      // the MPR keys (tools, W, C, O) are GATED to the MPR room — in any other mode they
      // used to silently mutate state the reader couldn't see. R also serves the
      // radiograph's fit, so it stays live there.
      const inMpr = viewMode === 'mpr' && !isXray;
      if (k === 'n') step(1);
      else if (k === 'p') step(-1);
      else if (inMpr && k >= '0' && k <= '9') {
        const mode = TOOL_ORDER[k === '0' ? 9 : Number(k) - 1];
        if (mode) setControls((c) => ({ ...c, toolMode: mode }));
      } else if (inMpr && k === 'w') setControls((c) => ({ ...c, toolMode: 'wl' }));
      else if ((inMpr || isXray) && k === 'r') setControls((c) => ({ ...c, resetNonce: c.resetNonce + 1 }));
      else if (inMpr && k === 'c') setControls((c) => ({ ...c, planeLines: !c.planeLines }));
      else if (inMpr && k === 'o') setControls((c) => ({ ...c, showOverlay: !c.showOverlay }));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, viewMode, isXray]);

  const setVoiPreset = (name: string) => {
    setControls((c) => ({ ...c, voi: WL_PRESETS[name] ?? null }));
  };
  const voiShown = controls.voi ?? meta?.defaultVoi ?? { center: 0, width: 1 };
  // Window sliders span this image's ACTUAL value range (full spectrum — the Auto/default
  // window always lies inside, so any hand-set window can be walked back; a fixed cap could
  // put the original width out of reach). Width runs on a log scale: narrow
  // windows get fine steps, the far end still reaches the full span. Bounds also swallow the
  // current value so the thumb never clips while histogram data is still loading. Fallbacks
  // are mode-aware: HU for a volume, 0–4095 gray for a 2D radiograph.
  const huMin = histogram?.minHu ?? (isXray ? 0 : -1000);
  const huMax = histogram?.maxHu ?? (isXray ? 4095 : 3000);
  const centerMin = Math.min(huMin, voiShown.center);
  const centerMax = Math.max(huMax, voiShown.center);
  const WIDTH_MIN = 10;
  const widthMax = Math.max(huMax - huMin, meta?.defaultVoi.width ?? 0, voiShown.width, 100);
  const widthToT = (w: number) =>
    Math.round((1000 * Math.log(Math.max(WIDTH_MIN, w) / WIDTH_MIN)) / Math.log(widthMax / WIDTH_MIN));
  const tToWidth = (t: number) => Math.round(WIDTH_MIN * Math.pow(widthMax / WIDTH_MIN, t / 1000));

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
      style3d: controls.render3d.style,
      gamma: controls.gamma,
    }),
    selectVolume: (id) => selectVolumeVerb(id, volumes, (v) => switchVolume(v)),
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
    setStyle3d: (style) => {
      if (!(style in RENDER_STYLES) && style !== AIR_PRESET) return `unknown 3D style: ${style} (valid: ${[...Object.keys(RENDER_STYLES), AIR_PRESET].join(', ')})`;
      if (isXray) return 'the open image is a 2D radiograph: there is no 3D render';
      pickStyle(style);
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
    onEvicted: () => setAgentEvicted(true),
  }, agentTransport); // the in-page agent's queue on every surface, plus the loopback bridge in the repo and the desktop app
  // the desktop app, read after hydration (the exported HTML is rendered without a navigator)
  const inShell = useSyncExternalStore(noSubscribe, () => IS_DESKTOP, () => false);
  // the manual (docs/web-build.md, section 13): the website opens its pages in a new tab; the
  // repo build and the desktop app show them in the help drawer beside the viewer
  const manualInTab = IS_WEB && !inShell;

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
      {IS_WEB && (
        <>
          {/* the web build's pickers: a folder (webkitdirectory, set on mount), one file, a marks file */}
          <input
            ref={folderInputRef}
            type="file"
            multiple
            hidden
            data-testid="open-folder-input"
            onChange={(e) => {
              onFilesChosen(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            hidden
            data-testid="open-file-input"
            onChange={(e) => {
              onFilesChosen(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={marksInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="load-marks-input"
            onChange={(e) => {
              void onLoadMarks(e.target.files);
              e.target.value = '';
            }}
          />
          {pendingSize && !researchOpen && (
            <SizeNoticeDialog
              label={pendingSize.label}
              bytes={pendingSize.bytes}
              onCancel={() => {
                setPendingSize(null);
                finishOpen(); // the reader declined the volume: nothing will load
              }}
              onContinue={() => {
                const next = pendingSize.anon;
                setPendingSize(null);
                // the clock restarts: the time spent reading the notice is not the open's
                setOpenPanel((p) => (p?.kind === 'busy' ? { ...p, startedAt: Date.now() } : p));
                switchVolume(next, true);
              }}
            />
          )}
          {researchOpen && (
            <ResearchUseDialog
              onAcknowledge={() => {
                acknowledgeResearch();
                setResearchOpen(false);
              }}
            />
          )}
        </>
      )}
      {AGENT_AVAILABLE && agentEvicted && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 12px',
            background: 'var(--warn)',
            color: '#000',
            fontSize: 13,
          }}
        >
          <span>
            Another viewer tab was opened and now holds the agent connection. This tab still
            works by hand, but agent commands go to the newer tab.
          </span>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid #000',
              background: 'transparent',
              color: '#000',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Reload to reclaim
          </button>
        </div>
      )}
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
        <AboutBadge product="CBCTScope" />
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
          {IS_WEB ? 'Research use only. Not a medical device.' : 'Research use only. Not for diagnosis.'}
        </span>
        {/* the opt-in in-page navigation agent (web build and desktop app): this toggle opens its panel under the viewer */}
        {IS_WEB && <AgentToggle />}
        {IS_WEB && (
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="the source code, the local app, and the user manual, on the project page"
            style={{ fontSize: 12, color: 'var(--text)' }}
          >
            repository
          </a>
        )}
        {IS_WEB && !inShell && (
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="the desktop app for macOS and Windows, with agent control over MCP, on the releases page"
            style={{ fontSize: 12, color: 'var(--text)' }}
          >
            Download the desktop app
          </a>
        )}
        {isXray ? (
          <span
            title="A single 2D radiograph is open. The volumetric reading modes apply to CBCT volumes."
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
              <button
                key={m}
                style={btn(viewMode === m)}
                title={tip}
                onClick={() => {
                  setError(null); // a fresh room is a fresh start — a stale pane error must not outlive the switch
                  setViewMode(m);
                }}
              >
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
          {/* the web build can hold a volume back (the size notice): say so instead of
              showing a volume that is not on screen */}
          {!anon && volumes.length > 0 && <option value="">choose a volume</option>}
          {volumes.some((v) => isFusedVol(v.anon)) && (
            <optgroup label="🧬 stitched (this session)">
              {volumes
                .filter((v) => isFusedVol(v.anon))
                .map((v) => (
                  <option key={v.anon} value={v.anon}>
                    {v.label || v.anon.slice(6, 12)}: {volLabel(v)}
                  </option>
                ))}
            </optgroup>
          )}
          {volumes.some((v) => isLocalVol(v.anon)) && (
            <optgroup label={`opened: ${srcLabel ?? ''}`}>
              {volumes
                .filter((v) => isLocalVol(v.anon))
                .map((v) => (
                  <option key={v.anon} value={v.anon}>
                    {v.label || v.anon.slice(6, 12)}: {volLabel(v)}
                  </option>
                ))}
            </optgroup>
          )}
          <optgroup label="built-in demo">
            {volumes
              .filter((v) => isDemoVol(v.anon))
              .map((v) => (
                <option key={v.anon} value={v.anon}>
                  {v.label || 'Synthetic phantom'}: {volLabel(v)}
                </option>
              ))}
          </optgroup>
        </select>
        <button style={btn(false)} onClick={() => step(1)} title="Next volume (N)">
          ›
        </button>
        {/* the export menu is volume-only (slice stacks, STL); snapshot answers in every
            mode including a 2D radiograph, which is the whole point of one door */}
        {!isXray && anon && (
          <ExportMenu
            anon={anon}
            voi={voiShown}
            invert={controls.invert}
            gamma={controls.gamma}
            stlThreshold={r3d.threshold}
            crop3d={controls.crop3d}
          />
        )}
        {anon && (
          <SnapshotButton
            onClick={() => snapRef.current?.()}
            title="snapshot: save what the current room shows as a PNG image. Each room composes its own."
          />
        )}
        {/* 📂 open a local CBCT export — DICOMDIR tree, slice-series folder, or multiframe file */}
        <div ref={srcMenuRef} style={{ position: 'relative' }}>
          <button
            style={btn(!!srcLabel)}
            disabled={picking}
            onClick={() => setSrcMenu((v) => !v)}
            title={
              IS_WEB
                ? picking
                  ? inShell
                    ? 'reading the files you chose into this app'
                    : 'reading the files you chose into this tab'
                  : inShell
                    ? 'Open a CBCT export (folder, DICOMDIR, or DICOM file), or drop it on the viewer. This app reads it on this computer; nothing is uploaded.'
                    : 'Open a CBCT export (folder, DICOMDIR, or DICOM file), or drop it on the viewer. The browser reads it into this tab; nothing is uploaded.'
                : picking
                  ? 'the native file chooser is open: finish or cancel it first'
                  : 'Open a local CBCT export (folder, DICOMDIR, or DICOM file). Scans are read in place and never leave this computer.'
            }
          >
            <FolderOpen size={13} strokeWidth={2} style={{ marginRight: 5, verticalAlign: '-2px' }} />
            {picking ? (IS_WEB ? 'opening…' : 'choosing…') : srcLabel ? `${srcLabel} ▾` : 'open ▾'}
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
              {IS_WEB ? (
                <>
                  <button
                    className="menu-item"
                    title="A CBCT export folder: a DICOMDIR tree, a slice series, or multiframe files"
                    onClick={() => {
                      setSrcMenu(false);
                      folderInputRef.current?.click();
                    }}
                  >
                    📁 Open DICOMDIR or DICOM folder
                  </button>
                  {/* the picker's own button may read "Upload": say what it means before it appears */}
                  <div style={{ padding: '2px 10px 6px', fontSize: 12, color: 'var(--text)', lineHeight: 1.45, maxWidth: 300 }}>
                    {inShell
                      ? "The Open sheet may say 'Upload': that is its word for letting this app read the files. They stay on this computer."
                      : "Your browser may say 'upload': that is its word for letting this page read the files. They stay in this tab."}
                  </div>
                  <button
                    className="menu-item"
                    title="One multiframe volume or one 2D radiograph"
                    onClick={() => {
                      setSrcMenu(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    🗄 Open a single DICOM file
                  </button>
                  {anon && (
                    <>
                      <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                      <button
                        className="menu-item"
                        title="Download the marks of the volume on screen (annotations, saved views, 3D ROIs) as a JSON file. No pixels."
                        onClick={() => void onSaveMarks()}
                      >
                        ⬇ Save marks to file
                      </button>
                      <button
                        className="menu-item"
                        title="Replace the marks of the volume on screen with a marks file saved earlier for this same volume"
                        onClick={() => {
                          setSrcMenu(false);
                          marksInputRef.current?.click();
                        }}
                      >
                        ⬆ Load marks from file
                      </button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <button className="menu-item" onClick={() => void onPickSource('folder')}>
                    📁 Open DICOMDIR or DICOM folder…
                  </button>
                  <button
                    className="menu-item"
                    title="One DICOMDIR, one multiframe volume, one 2D radiograph, or one slice (opens its whole series)"
                    onClick={() => void onPickSource('file')}
                  >
                    🗄 Open a single DICOM file…
                  </button>
                </>
              )}
              {srcLabel && (
                <>
                  <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                  <button className="menu-item" onClick={() => void onCloseSource()}>
                    ✕ Close {srcLabel}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {current && (
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            {/* the case identity leads the line in full contrast — the id everything else
                (exports, sidecars) is filed under; local/fused volumes show their label */}
            <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {isDemoVol(current.anon)
                ? 'Synthetic phantom'
                : (isFusedVol(current.anon) || isLocalVol(current.anon)) && current.label
                  ? current.label
                  : current.anon}
            </span>
            {' · '}
            {volLabel(current)} ·{' '}
            {current.kind === 'mf' ? 'multiframe' : current.kind === 'xray' ? 'radiograph' : 'slices'} ·{' '}
            {(current.spacing[0] * 1000).toFixed(0)} µm {current.kind === 'xray' ? 'pixels' : 'voxels'}
            {/* first-run hint: while the built-in phantom is on screen and nothing of the reader's
                is open, say so and point at the two doors. A line in the header, not a dialog:
                nothing to dismiss, and it leaves by itself once an export is opened. */}
            {isDemoVol(current.anon) && !srcLabel && (
              <span style={{ color: 'var(--text)' }}>
                {'. '}Built in, no patient data. For your own scan: <b>open</b>
                {IS_WEB ? ' or drop it on the viewer' : ''}. The guide: <b>help</b>.
              </span>
            )}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
          {isXray
            ? 'Wheel zooms, left-drag pans, double-click or R fits.'
            : MODE_LEGEND[viewMode](
                controls.toolMode === 'crosshairs' ? 'a click spots the crosshairs, a drag pans' : TOOL_LABEL[controls.toolMode],
              )}
          {' Double-click a slider to reset it.'}
        </span>
        <div style={{ position: 'relative' }}>
          <button
            style={btn(keysOpen)}
            onClick={() => setKeysOpen((v) => !v)}
            title="keyboard reference: every hotkey, in words"
          >
            <Keyboard size={13} strokeWidth={2} style={{ marginRight: 5, verticalAlign: '-2px' }} />
            keys
          </button>
          {keysOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 6,
                zIndex: 30,
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                padding: '10px 14px',
                fontSize: 12,
                lineHeight: 1.8,
                whiteSpace: 'nowrap',
              }}
            >
              <div style={{ color: 'var(--text-dim)', fontSize: 10, letterSpacing: 0.4, marginBottom: 2 }}>
                EVERY ROOM
              </div>
              <div>N / P: next / previous volume</div>
              <div>double-click a slider: reset it</div>
              <div style={{ color: 'var(--text-dim)', fontSize: 10, letterSpacing: 0.4, margin: '6px 0 2px' }}>
                MPR ONLY
              </div>
              <div>1–9, 0: tools (crosshairs … 3D ROI)</div>
              <div>W: window/level tool</div>
              <div>R: reset orientation (also fits a 2D radiograph)</div>
              <div>C: plane lines on / off</div>
              <div>O: overlays on / off</div>
              <div>V: save the current view</div>
              <div>Del: delete the selected object</div>
            </div>
          )}
        </div>
        {/* help: this mode's reading guide (manual chapter 8) and the user manual, as pages
            this viewer's own origin serves (manual/, rendered from docs/ at build time). The
            website opens them in a new tab; the repo build and the desktop app in the drawer
            beside the viewer. Nothing is fetched from anywhere else. */}
        <div ref={helpMenuRef} style={{ position: 'relative' }}>
          <button
            style={btn(helpMenu)}
            onClick={() => setHelpMenu((v) => !v)}
            title={
              manualInTab
                ? 'help: the reading guide for this mode and the user manual, served by this site, in a new tab'
                : 'help: the reading guide for this mode and the user manual, in a drawer beside the viewer'
            }
          >
            <BookOpen size={13} strokeWidth={2} style={{ marginRight: 5, verticalAlign: '-2px' }} />
            help ▾
          </button>
          {helpMenu && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                zIndex: 50,
                marginTop: 2,
                minWidth: 240,
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                padding: 4,
              }}
            >
              {(
                [
                  [
                    guidePage(viewMode, isXray),
                    `📖 ${isXray ? '2D radiographs, in the manual' : `${VIEW_MODES.find(([m]) => m === viewMode)?.[1] ?? viewMode} reading guide`}`,
                  ],
                  ['index.html', '📘 User manual'],
                ] as const
              ).map(([page, label]) =>
                manualInTab ? (
                  <a
                    key={page}
                    className="menu-item"
                    style={{ textDecoration: 'none', color: 'var(--text)', boxSizing: 'border-box' }}
                    href={manualHref(page)}
                    target="_blank"
                    rel="noopener"
                    onClick={() => setHelpMenu(false)}
                  >
                    {label}
                  </a>
                ) : (
                  <button
                    key={page}
                    className="menu-item"
                    style={{ color: 'var(--text)', boxSizing: 'border-box' }}
                    onClick={() => {
                      setManualPage(page);
                      setHelpMenu(false);
                    }}
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* the viewer column: the agent panel, when open, docks under the viewer and pushes it up */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <main
          style={{ flex: 1, minWidth: 0, minHeight: 0, padding: 8, position: 'relative' }}
          // the web build: a drop anywhere on the viewer opens it (folders walked recursively)
          {...(IS_WEB ? drop.handlers : {})}
        >
          {IS_WEB && drop.over && (
            <div
              data-testid="drop-zone"
              style={{
                position: 'absolute',
                inset: 8,
                zIndex: 20,
                border: '2px dashed var(--text)',
                borderRadius: 8,
                background: 'rgba(0,0,0,0.6)',
                color: 'var(--text)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 15,
                pointerEvents: 'none',
              }}
            >
              Drop a DICOM folder, a DICOMDIR or a single file here. Nothing is uploaded.
            </div>
          )}
          {IS_WEB && openPanel && !(openPanel.kind === 'busy' && pendingSize) && (
            <OpenProgressPanel
              state={openPanel}
              onDismiss={() => setOpenPanel(null)}
              onOpenAnother={() => {
                setOpenPanel(null);
                folderInputRef.current?.click();
              }}
            />
          )}
          {marksBusy ? (
            <div style={{ color: 'var(--text)', padding: 24 }}>loading marks…</div>
          ) : error ? (
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ color: 'var(--warn)' }}>{error}</div>
              <button
                style={btn(false)}
                onClick={() => setError(null)}
                title="clear the error and remount the room. A transient load failure retries."
              >
                ↻ retry
              </button>
            </div>
          ) : anon ? (
            isXray ? (
              <CbctRadiograph
                anon={anon}
                snapRef={snapRef}
                voi={controls.voi}
                invert={controls.invert}
                gamma={controls.gamma}
                resetNonce={controls.resetNonce}
                fullResetNonce={controls.fullResetNonce}
                onMeta={onRoomMeta}
                onHistogram={setHistogram}
                onError={setError}
              />
            ) : viewMode === 'mpr' ? (
              <CbctViewport
                anon={anon}
                snapRef={snapRef}
                controls={controls}
                onMeta={setMeta}
                onHistogram={setHistogram}
                onError={setError}
                onControlsPatch={(p) =>
                  // a saved view may name a 3D preset the interface no longer offers: it opens on a house style
                  setControls((c) => ({ ...c, ...p, ...(p.render3d ? { render3d: migrateRender3d(p.render3d) } : {}) }))
                }
              />
            ) : viewMode === 'grid' ? (
              <CbctGrid
                anon={anon}
                snapRef={snapRef}
                voi={controls.voi}
                invert={controls.invert}
                gamma={controls.gamma}
                onMeta={onRoomMeta}
                onError={setError}
              />
            ) : viewMode === 'tmj' ? (
              <CbctTmj
                anon={anon}
                gamma={controls.gamma}
                snapRef={snapRef}
                voi={controls.voi}
                invert={controls.invert}
                onMeta={onRoomMeta}
                onError={setError}
              />
            ) : viewMode === 'reslice' ? (
              <CbctReslice
                anon={anon}
                gamma={controls.gamma}
                snapRef={snapRef}
                voi={controls.voi}
                invert={controls.invert}
                onMeta={onRoomMeta}
                onError={setError}
              />
            ) : viewMode === 'ceph' ? (
              <CbctCeph
                anon={anon}
                gamma={controls.gamma}
                snapRef={snapRef}
                onVoi={(v) => setControls((c) => ({ ...c, voi: v }))}
                voi={controls.voi}
                invert={controls.invert}
                onMeta={onRoomMeta}
                onError={setError}
              />
            ) : viewMode === 'region' ? (
              <CbctRegion
                anon={anon}
                gamma={controls.gamma}
                snapRef={snapRef}
                voi={controls.voi}
                invert={controls.invert}
                onMeta={onRoomMeta}
                onError={setError}
              />
            ) : viewMode === 'stitch' ? (
              <CbctStitch
                anon={anon}
                gamma={controls.gamma}
                snapRef={snapRef}
                voi={controls.voi}
                invert={controls.invert}
                volumes={volumes.filter((v) => v.kind !== 'xray')}
                onFused={onFused}
                onMeta={onRoomMeta}
                onError={setError}
              />
            ) : (
              <CbctPano
                anon={anon}
                gamma={controls.gamma}
                snapRef={snapRef}
                voi={controls.voi}
                invert={controls.invert}
                onMeta={onRoomMeta}
                onError={setError}
              />
            )
          ) : (
            <div style={{ color: 'var(--text-dim)', padding: 24 }}>
              {volumes.length ? 'no volume open: choose one from the volume list' : 'no volumes available'}
            </div>
          )}
        </main>
        {IS_WEB && <AgentPanel />}
        </div>

        <aside
          style={{
            width: 240,
            borderLeft: '1px solid var(--border)',
            background: 'var(--panel)',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            overflowY: 'auto',
          }}
        >
          {viewMode === 'mpr' && !isXray && (
          <section>
            <div style={{ color: 'var(--text-dim)', marginBottom: 6 }}>Tool (1–9, 0, W)</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TOOL_ORDER.map((m, i) => (
                <button
                  key={m}
                  style={btn(controls.toolMode === m)}
                  onClick={() => setControls((c) => ({ ...c, toolMode: m }))}
                  title={
                    m === 'wl'
                      ? 'window/level (W). Left-drag on any slice: up and down set the center, left and right the width. The sidebar follows live.'
                      : `${TOOL_LABEL[m]} (${TOOL_KEY(m, i)})`
                  }
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
                  title="drag a rectangle on any slice pane; the box extends this many mm through the slice. Double-click resets to 10."
                  style={{ width: '100%' }}
                />
              </label>
            )}
            <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.5 }}>
              Arrow and Text ask for a label. Rect and Ellipse report density (HU) stats. Freehand:
              an open stroke gives a curved-path length in mm, a closed loop gives region stats. 3D
              ROI: drag a box to get volume and density stats. Del deletes the selected object.
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
                  <button
                    key={name}
                    style={btn(active)}
                    onClick={() => setVoiPreset(name)}
                    title={
                      p
                        ? `center ${p.center}, width ${p.width} HU`
                        : "robust percentile window from this image's own pixels (the per-volume default)"
                    }
                  >
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
                  defaults={
                    meta
                      ? {
                          lower: Math.round(meta.defaultVoi.center - meta.defaultVoi.width / 2),
                          upper: Math.round(meta.defaultVoi.center + meta.defaultVoi.width / 2),
                        }
                      : undefined
                  }
                />
              </div>
            )}
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
              center {voiShown.center}
              <input
                type="range"
                min={centerMin}
                max={centerMax}
                step={5}
                value={voiShown.center}
                onChange={(e) =>
                  setControls((c) => ({
                    ...c,
                    voi: { center: Number(e.target.value), width: voiShown.width },
                  }))
                }
                onDoubleClick={() =>
                  meta &&
                  setControls((c) => ({
                    ...c,
                    voi: { center: meta.defaultVoi.center, width: voiShown.width },
                  }))
                }
                title="full value range of this image. Double-click returns to the Auto center."
                style={{ width: '100%' }}
              />
            </label>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
              width {voiShown.width}
              <input
                type="range"
                min={0}
                max={1000}
                step={1}
                value={widthToT(voiShown.width)}
                onChange={(e) =>
                  setControls((c) => ({
                    ...c,
                    voi: { center: voiShown.center, width: tToWidth(Number(e.target.value)) },
                  }))
                }
                onDoubleClick={() =>
                  meta &&
                  setControls((c) => ({
                    ...c,
                    voi: { center: voiShown.center, width: meta.defaultVoi.width },
                  }))
                }
                title="log scale up to the image's full span. Double-click returns to the Auto width."
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
                title="display gamma. Double-click to reset to 1."
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
                  onDoubleClick={() =>
                    setControls((c) => ({ ...c, slabByPane: { ...c.slabByPane, [p]: 0.1 } }))
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
            {/* the house styles as one-click chips, then one library preset, Air, applied as-is */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
              {Object.entries(RENDER_STYLES).map(([value, d]) => (
                <button
                  key={value}
                  style={btn(r3d.style === value)}
                  onClick={() => pickStyle(value)}
                  title={d.group === 'cbct' ? `${d.label}, CBCT-tuned` : d.label}
                >
                  {d.label.replace('CBCT · ', '')}
                </button>
              ))}
              <button
                style={btn(r3d.style === AIR_PRESET)}
                onClick={() => pickStyle(AIR_PRESET)}
                title="Air: the library's air preset, applied as it is. The adjust sliders do not apply to it."
              >
                Air
              </button>
            </div>
            {styleDef ? (
              <>
                {histogram && (
                  <div style={{ marginBottom: 6 }}>
                    <CbctHistogram
                      data={histogram}
                      threshold={r3d.threshold}
                      onThreshold={(hu) => setR3d({ threshold: hu })}
                      defaults={{ threshold: styleDef.defaultThreshold }}
                    />
                  </div>
                )}
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                  cut-off threshold {r3d.threshold} HU (densities below stay transparent)
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
                  depth enhancement {r3d.depthEnhance} (flat interiors fade, surfaces pop)
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={r3d.depthEnhance}
                    onChange={(e) => setR3d({ depthEnhance: Number(e.target.value) })}
                    onDoubleClick={() => setR3d({ depthEnhance: 0 })}
                    style={{ width: '100%' }}
                  />
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, margin: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={r3d.smooth3d}
                    onChange={(e) => setR3d({ smooth3d: e.target.checked })}
                  />
                  smooth 3D surface (denoised copy; slice views stay untouched)
                </label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, margin: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={r3d.cinematic}
                    onChange={(e) => setR3d({ cinematic: e.target.checked })}
                  />
                  cinematic light (soft in-volume shadows; slower to orbit)
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
                        onDoubleClick={() => setR3d({ lightAz: DEFAULT_RENDER3D.lightAz })}
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
                        onDoubleClick={() => setR3d({ lightEl: DEFAULT_RENDER3D.lightEl })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </>
                )}
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, margin: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={r3d.stOverlay}
                    onChange={(e) => setR3d({ stOverlay: e.target.checked })}
                  />
                  soft-tissue overlay (skin-toned shell under the cut-off)
                </label>
                {r3d.stOverlay && (
                  <>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                      tissue threshold {r3d.stThreshold} HU
                      <input
                        type="range"
                        min={-800}
                        max={200}
                        step={10}
                        value={r3d.stThreshold}
                        onChange={(e) => setR3d({ stThreshold: Number(e.target.value) })}
                        onDoubleClick={() => setR3d({ stThreshold: DEFAULT_RENDER3D.stThreshold })}
                        style={{ width: '100%' }}
                      />
                    </label>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-dim)' }}>
                      tissue opacity {r3d.stOpacity}%
                      <input
                        type="range"
                        min={5}
                        max={80}
                        step={1}
                        value={r3d.stOpacity}
                        onChange={(e) => setR3d({ stOpacity: Number(e.target.value) })}
                        onDoubleClick={() => setR3d({ stOpacity: DEFAULT_RENDER3D.stOpacity })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 4 }}>
                Air is applied as it is. The adjust sliders work on the other styles only.
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
              plane indicators: the three section planes and the bounding box inside the render
            </label>
          </section>
          )}

          {viewMode === 'mpr' && !isXray && (
          <section>
            <div style={{ color: 'var(--text-dim)', marginBottom: 6 }}>
              Crop 3D <span style={{ fontSize: 10 }}>(render only; slices unaffected)</span>
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
                      onDoubleClick={() =>
                        setControls((c) => {
                          const pair: [number, number] = [...c.crop3d[axis]];
                          pair[idx] = idx === 0 ? 0 : 1;
                          return { ...c, crop3d: { ...c.crop3d, [axis]: pair } };
                        })
                      }
                      title={
                        (idx === 0 ? `crop from the ${label.split(' ')[0]} side` : `crop from the ${label.split(' ')[2]} side`) +
                        '. Double-click removes the crop.'
                      }
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
              title="full volume back in the render: crop box reset + the right-drag cut removed"
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
                  title={defaultPreset === p.name ? 'default on app start. Click to unset.' : 'set as the default on app start'}
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
              plane lines (C), synced on all three views
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={controls.showOverlay}
                onChange={(e) => setControls((c) => ({ ...c, showOverlay: e.target.checked }))}
              />
              show overlays (O): lines, measurements, labels
            </label>
            <button
              style={{ ...btn(false), width: '100%', marginBottom: 6 }}
              onClick={() => setControls((c) => ({ ...c, resetNonce: c.resetNonce + 1 }))}
              title="Cameras back to orthogonal. Window and everything else untouched (R)."
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
                title="Fit the radiograph to the pane. Window untouched (R)."
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
              ? 'Radiograph: the wheel zooms about the cursor, left-drag pans, double-click or R refits. Gray values are display-normalized (0-4095): window them via the histogram or sliders; they are not HU.'
              : 'Measurements are true anatomical mm (isotropic voxels): unlike pano mm, no projection magnification. Crosshairs: drag the lines to re-slice; wheel scrolls the hovered pane.'}
          </div>
        </aside>
        {/* the user manual's drawer: a column of this row, so it narrows the viewer and covers nothing */}
        {manualPage !== null && <ManualDrawer page={manualPage} onClose={() => setManualPage(null)} />}
      </div>
    </div>
  );
}
