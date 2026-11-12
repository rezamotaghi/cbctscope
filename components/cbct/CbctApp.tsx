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
import ManualDrawer, { guidePage, MANUAL_EVENT, manualHref } from './ManualDrawer';
import { AGENT_AVAILABLE, IS_DESKTOP } from './shell';
import { IS_WEB, isCanceled, source } from './source';
import { EVIDENCE_SCHEMA, parseMarksFile, type EvidenceFile } from './evidence';
import { SIZE_NOTICE_MIB, needsSizeNotice, voxelBytes } from './sizeNotice';
import { dropLabel, entriesOf, walkDrop } from './dropFiles';
import { chooseFolder, usesDirectoryPicker, walkHandle } from './folderPicker';
import { selectVolumeVerb, type SwitchOutcome } from './agentSelect';
import { useDropOverlay } from './useDropOverlay';
import { isChord, modalOpen } from './keys';
import { downloadBlob } from './exporters';
import {
  ResearchUseDialog,
  SizeNoticeDialog,
  acknowledgeResearch,
  researchAcknowledged,
} from './WebDialogs';
import AboutBadge from '@/components/AboutBadge';
import type { Citation } from '@/components/citation';
import CiteDialog from './CiteDialog';
import SnapshotButton, { type SnapRef } from './SnapshotButton';
import { pageStorage, rememberPreset, windowOnOpen } from './windowPreset';
import { EVERY_MODE_GESTURES, MODE_GESTURES, statusLegend, type GestureMode } from './gestures';
import { PANE_BUTTONS } from './paneButtons';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { REPO_URL, RELEASES_URL, STILLS_URL } from '@/components/links';
import { downloadEntries } from '@/components/downloads';
import { onMenuButtonKeyDown, onMenuKeyDown, useDismiss, useKeepInViewport } from './menus';

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

/** User-opened local volume (the Open menu). */
const isLocalVol = (id: string) => id.startsWith('local_');
/** Session-scoped stitched (fused) volume from the Stitch view. */
const isFusedVol = (id: string) => id.startsWith('fused_');
/** Built-in synthetic demo phantom. */
const isDemoVol = (id: string) => id.startsWith('demo_');

type ViewMode = 'mpr' | 'grid' | 'pano' | 'tmj' | 'reslice' | 'ceph' | 'region' | 'stitch';

/** the built-in phantom's one name: lib/shared/phantom.ts PHANTOM_LABEL says the same (tests/manual.test.ts) */
const PHANTOM_NAME = 'Geometric test phantom';
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

export default function CbctApp({ citation }: { citation?: Citation }) {
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

  // the opened source: native chooser, persisted server-side
  const [srcLabel, setSrcLabel] = useState<string | null>(null);
  const [srcNonce, setSrcNonce] = useState(0); // bump = refetch the volume list
  const [srcMenu, setSrcMenu] = useState(false);
  /** the header's help menu: this mode's reading guide and the user manual */
  const [helpMenu, setHelpMenu] = useState(false);
  /** the manual page the help drawer shows, or null when it is closed (repo build and desktop app) */
  const [manualPage, setManualPage] = useState<string | null>(null);
  const [citeOpen, setCiteOpen] = useState(false);
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
  // the header's menus and the Keys card: Escape or a press outside (the image included) closes
  // each; each panel stays inside the viewport (menus.ts)
  const keysRef = useRef<HTMLDivElement | null>(null);
  const srcPanelRef = useRef<HTMLDivElement | null>(null);
  const helpPanelRef = useRef<HTMLDivElement | null>(null);
  const keysPanelRef = useRef<HTMLDivElement | null>(null);
  /** the header's download menu (plain browser only): the installers, the visitor's system first */
  const [dlMenu, setDlMenu] = useState(false);
  const dlMenuRef = useRef<HTMLDivElement | null>(null);
  const dlPanelRef = useRef<HTMLDivElement | null>(null);
  const closeSrc = useCallback(() => setSrcMenu(false), []);
  const closeHelp = useCallback(() => setHelpMenu(false), []);
  const closeKeys = useCallback(() => setKeysOpen(false), []);
  const closeDl = useCallback(() => setDlMenu(false), []);
  useDismiss(srcMenu, closeSrc, srcMenuRef);
  useDismiss(helpMenu, closeHelp, helpMenuRef);
  useDismiss(keysOpen, closeKeys, keysRef);
  useDismiss(dlMenu, closeDl, dlMenuRef);
  useKeepInViewport(srcMenu, srcPanelRef);
  useKeepInViewport(helpMenu, helpPanelRef);
  useKeepInViewport(keysOpen, keysPanelRef);
  useKeepInViewport(dlMenu, dlPanelRef);

  const current = useMemo(() => volumes.find((v) => v.anon === anon) ?? null, [volumes, anon]);
  /** the open image is a single 2D radiograph — the volumetric modes don't apply */
  const isXray = current?.kind === 'xray';
  // the desktop app opens every CT volume on the window preset the reader last picked
  // (./windowPreset); a radiograph opens on Auto; the website remembers nothing new
  const currentKind = current?.kind ?? null;
  useEffect(() => {
    if (!anon || !currentKind) return;
    const voi = windowOnOpen(pageStorage(), IS_DESKTOP, currentKind === 'xray', WL_PRESETS);
    setControls((c) => ({ ...c, voi }));
  }, [anon, currentKind]);

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
    setPendingSize({ anon: next, label: v.label || (isDemoVol(next) ? PHANTOM_NAME : next), bytes });
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
  /** a drop or a picked folder handle: walked into files, then the one loader */
  const openWalked = useCallback(
    async (walk: () => Promise<{ files: File[]; stopped: string | null; label: string }>, what: string) => {
      const token = beginOpen(); // the panel shows while the tree is walked, before the count is known
      try {
        const { files, stopped, label } = await walk();
        if (files.length) await openWith({ kind: 'files', files, label, ...(stopped ? { walkStopped: stopped } : {}) }, token);
        else if (openTokenRef.current === token) setOpenPanel(null);
      } catch (e) {
        if (openTokenRef.current === token) setOpenPanel(null);
        setError(`could not read ${what}: ${String(e)}`);
      }
    },
    [openWith, beginOpen],
  );
  const onDropFiles = useCallback(
    async (dt: DataTransfer) => {
      const entries = entriesOf(dt); // synchronous: the items die after the drop handler
      if (!entries.length) return;
      await openWalked(async () => ({ ...(await walkDrop(entries)), label: dropLabel(entries) }), 'the dropped files');
    },
    [openWalked],
  );
  /** the folder item: the directory picker where offered (no "upload" confirmation), else the classic input */
  const onOpenFolder = useCallback(async () => {
    setSrcMenu(false);
    const choice = await chooseFolder(typeof window === 'undefined' ? null : window, IS_DESKTOP);
    if (choice.kind === 'canceled') return; // the reader closed the picker: nothing happens
    if (choice.kind === 'classic') return folderInputRef.current?.click();
    await openWalked(() => walkHandle(choice.handle), 'the chosen folder');
  }, [openWalked]);
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
      // a modal dialogue holds the keyboard: no volume switch or tool change behind it
      if (modalOpen()) return;
      const k = e.key.toLowerCase();
      // the MPR keys (tools, W, C, O) are GATED to the MPR room: in any other mode they
      // would silently change state the reader cannot see. R also serves the
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

  /** a preset picked by the reader: applied, and on the desktop app remembered for a CT volume */
  const setVoiPreset = (name: string) => {
    setControls((c) => ({ ...c, voi: WL_PRESETS[name] ?? null }));
    if (!isXray) rememberPreset(pageStorage(), IS_DESKTOP, name, WL_PRESETS);
  };
  const voiShown = controls.voi ?? meta?.defaultVoi ?? { center: 0, width: 1 };
  /** a window is known (set by hand, or the volume's own): until then the rail shows no number */
  const voiKnown = controls.voi !== null || !!meta;
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
        setVoiPreset(preset);
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
  // the folder item's entrance, known only in the browser (the static export renders the classic line)
  const dirPicker = useSyncExternalStore(noSubscribe, () => usesDirectoryPicker(window, IS_DESKTOP), () => false);
  // the manual (docs/web-build.md, section 13): the website opens its pages in a new tab; the
  // repo build and the desktop app show them in the help drawer beside the viewer
  const manualInTab = IS_WEB && !inShell;
  // the desktop app's Help menu: its window event opens the drawer at the manual's index page,
  // through the same state the help menu sets (a second request keeps the one drawer)
  useEffect(() => {
    if (!IS_DESKTOP) return;
    const open = () => {
      setManualPage('index.html');
      setHelpMenu(false);
    };
    window.addEventListener(MANUAL_EVENT, open);
    return () => window.removeEventListener(MANUAL_EVENT, open);
  }, []);

  /**
   * A Help menu entry for one of the site's own pages (/about, /legal): a new tab on the website,
   * like the manual; the drawer beside the viewer in the local app and the desktop app, where a
   * new tab is not available. The address is relative, so a base path holds.
   */
  const siteLink = (page: 'about' | 'legal', label: string, title: string) =>
    manualInTab ? (
      <a className="menu-item" role="menuitem" href={page} target="_blank" rel="noopener" title={title} onClick={() => setHelpMenu(false)}>
        {label}
      </a>
    ) : (
      <button
        className="menu-item"
        role="menuitem"
        title={title}
        onClick={() => {
          setManualPage(page);
          setHelpMenu(false);
        }}
      >
        {label}
      </button>
    );

  /** the status line's gesture legend: at most three of this mode's, MPR's aware of the active tool */
  const gestureMode: GestureMode = isXray ? 'xray' : viewMode;
  const legend = statusLegend(gestureMode, controls.toolMode === 'crosshairs' ? null : TOOL_LABEL[controls.toolMode]);

  /** a chip in the side rail: the one button, solid accent while it is the selected one */
  const chip = (active: boolean) => ({ className: 'ctl', 'aria-pressed': active });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {IS_WEB && (
        <>
          {/* the web build's pickers: a folder (webkitdirectory, set on mount; the fallback where the
              directory picker is absent, and the desktop app's), one file, a marks file */}
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
            className="ctl"
            onClick={() => window.location.reload()}
            style={{ borderColor: '#000', background: 'transparent', color: '#000', fontWeight: 600 }}
          >
            Reload to reclaim
          </button>
        </div>
      )}
      {/* below 768 px: a phone or a narrow window can look at the phantom, not read a scan. It
          comes first in the document so it is read first; CSS order shows it under the header. */}
      <div className="phone-notice" role="note">
        CBCTScope reads scans in a desktop browser. Here you can look at the built-in phantom.
      </div>
      {/* the header: one row where the width holds it, in reading order: what this is, the
          modes, the volume, the actions, then Keys, Help, Agent and the desktop download */}
      <header className="app-header" data-testid="app-header">
        <div className="hgroup" style={{ gap: 8 }}>
          {/* the name with its version button, and under them what this is */}
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '14px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <strong style={{ fontSize: 'var(--fs-body)', fontWeight: 600 }}>CBCTScope</strong>
              <AboutBadge product="CBCTScope" onOpenAbout={manualInTab ? undefined : () => setManualPage('about')} />
            </span>
            <span style={{ fontSize: 'var(--fs-meta)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>CBCT and radiograph viewer</span>
          </div>
          <span
            title="This viewer is research software: it visualizes and navigates volumes and never produces findings or diagnoses. It is not a medical device."
            style={{
              fontSize: 'var(--fs-meta)',
              lineHeight: '13px',
              color: 'var(--warn)',
              border: '1px solid var(--warn)',
              borderRadius: 'var(--ctl-radius)',
              padding: '0 8px',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ display: 'block' }}>Research use only.</span>{' '}
            <span style={{ display: 'block' }}>{IS_WEB ? 'Not a medical device.' : 'Not for diagnosis.'}</span>
          </span>
        </div>
        {isXray ? (
          <span
            title="A single 2D radiograph is open. The volumetric reading modes apply to CBCT volumes."
            className="ctl"
            style={{ cursor: 'default' }}
          >
            2D radiograph
          </span>
        ) : (
          <div className="tabs" role="group" aria-label="Reading mode">
            {VIEW_MODES.map(([m, label, tip]) => (
              <button
                key={m}
                className="tab"
                aria-pressed={viewMode === m}
                title={tip}
                onClick={() => {
                  setError(null); // a fresh room is a fresh start: a stale pane error must not outlive the switch
                  setViewMode(m);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {/* previous, the volume list and next: one group that never wraps apart */}
        <div className="hgroup hgroup-volume">
          <button className="ctl" style={{ padding: '0 4px' }} onClick={() => step(-1)} aria-label="Previous volume" title="Previous volume (P)">
            <ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
          </button>
          <select className="hselect" aria-label="Volume" value={anon ?? ''} onChange={(e) => switchVolume(e.target.value)}>
            {/* the web build can hold a volume back (the size notice): say so instead of
                showing a volume that is not on screen */}
            {!anon && volumes.length > 0 && <option value="">Choose a volume</option>}
            {volumes.some((v) => isFusedVol(v.anon)) && (
              <optgroup label="Stitched (this session)">
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
              <optgroup label={`Opened: ${srcLabel ?? ''}`}>
                {volumes
                  .filter((v) => isLocalVol(v.anon))
                  .map((v) => (
                    <option key={v.anon} value={v.anon}>
                      {v.label || v.anon.slice(6, 12)}: {volLabel(v)}
                    </option>
                  ))}
              </optgroup>
            )}
            <optgroup label="Built in">
              {volumes
                .filter((v) => isDemoVol(v.anon))
                .map((v) => (
                  <option key={v.anon} value={v.anon}>
                    {v.label || PHANTOM_NAME}: {volLabel(v)}
                  </option>
                ))}
            </optgroup>
          </select>
          <button className="ctl" style={{ padding: '0 4px' }} onClick={() => step(1)} aria-label="Next volume" title="Next volume (N)">
            <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
        {/* Open: a local CBCT export (DICOMDIR tree, slice-series folder, or multiframe file).
            It always reads Open; the opened source's name is in the volume list and the status line. */}
        <div ref={srcMenuRef} style={{ position: 'relative' }}>
          <button
            className="ctl"
            aria-expanded={srcMenu}
            aria-haspopup="menu"
            disabled={picking}
            onClick={() => setSrcMenu((v) => !v)}
            onKeyDown={(e) => onMenuButtonKeyDown(e, srcMenu, setSrcMenu, srcPanelRef)}
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
            Open
          </button>
          {srcMenu && (
            <div ref={srcPanelRef} className="menu-panel" role="menu" aria-label="Open" onKeyDown={onMenuKeyDown} style={{ left: 0, minWidth: 260 }}>
              {IS_WEB ? (
                <>
                  <button
                    className="menu-item"
                    role="menuitem"
                    title="A CBCT export folder: a DICOMDIR tree, a slice series, or multiframe files"
                    onClick={() => void onOpenFolder()}
                  >
                    Open DICOMDIR or DICOM folder
                  </button>
                  {/* what the browser will ask, before it asks: the classic input's button may read "Upload" */}
                  <div style={{ padding: '0 10px 8px', color: 'var(--text)', lineHeight: 1.5, maxWidth: 300, whiteSpace: 'normal' }}>
                    {inShell
                      ? "The Open sheet may say 'Upload': that is its word for letting this app read the files. They stay on this computer."
                      : dirPicker
                        ? 'Your browser will ask to let this page view and copy the files. It reads them into this tab and sends them nowhere.'
                        : "Your browser may say 'upload': that is its word for letting this page read the files. They stay in this tab."}
                  </div>
                  {!inShell && (
                    <div style={{ padding: '0 10px 8px', color: 'var(--text)', lineHeight: 1.5, maxWidth: 300, whiteSpace: 'normal' }}>
                      Or drop the folder on the viewer: the browser asks nothing.
                    </div>
                  )}
                  <button
                    className="menu-item"
                    role="menuitem"
                    title="One multiframe volume or one 2D radiograph"
                    onClick={() => {
                      setSrcMenu(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    Open a single DICOM file
                  </button>
                  {anon && (
                    <>
                      <div role="separator" style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                      <button
                        className="menu-item"
                        role="menuitem"
                        title="Download the marks of the volume on screen (annotations, saved views, 3D ROIs) as a JSON file. No pixels."
                        onClick={() => void onSaveMarks()}
                      >
                        Save marks to file
                      </button>
                      <button
                        className="menu-item"
                        role="menuitem"
                        title="Replace the marks of the volume on screen with a marks file saved earlier for this same volume"
                        onClick={() => {
                          setSrcMenu(false);
                          marksInputRef.current?.click();
                        }}
                      >
                        Load marks from file
                      </button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <button className="menu-item" role="menuitem" onClick={() => void onPickSource('folder')}>
                    Open DICOMDIR or DICOM folder…
                  </button>
                  <button
                    className="menu-item"
                    role="menuitem"
                    title="One DICOMDIR, one multiframe volume, one 2D radiograph, or one slice (opens its whole series)"
                    onClick={() => void onPickSource('file')}
                  >
                    Open a single DICOM file…
                  </button>
                </>
              )}
              {srcLabel && (
                <>
                  <div role="separator" style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                  <button className="menu-item" role="menuitem" onClick={() => void onCloseSource()}>
                    Close {srcLabel}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
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
        <span style={{ flex: '1 0 0' }} />
        <div className="hgroup" style={{ gap: 8 }}>
          <div ref={keysRef} style={{ position: 'relative' }}>
            <button
              className="ctl"
              aria-expanded={keysOpen}
              aria-haspopup="dialog"
              onClick={() => setKeysOpen((v) => !v)}
              title="this mode's keys and mouse gestures, in words"
            >
              Keys
            </button>
            {keysOpen && (
              <div
                ref={keysPanelRef}
                className="menu-panel"
                role="dialog"
                aria-label="Keys"
                style={{ right: 0, padding: '8px 12px', lineHeight: 1.6, width: 'min(680px, calc(100vw - 16px))' }}
              >
                <div className="keys-cols">
                  <div className="keys-col">
                    <div className="pop-head">Keys</div>
                    <div>N / P: next / previous volume</div>
                    {isXray ? (
                      <div>R: fit the radiograph to the pane</div>
                    ) : viewMode === 'mpr' ? (
                      <>
                        <div>1 to 9, 0: tools (Crosshairs to 3D ROI)</div>
                        <div>W: window/level tool</div>
                        <div>R: reset orientation</div>
                        <div>C: plane lines on or off</div>
                        <div>O: overlays on or off</div>
                        <div>V: save the current view</div>
                        <div>Del: delete the selected object</div>
                      </>
                    ) : (
                      <div>{VIEW_MODES.find(([m]) => m === viewMode)?.[1]} has no keys of its own.</div>
                    )}
                    {!isXray && viewMode === 'mpr' && (
                      <>
                        <div className="pop-head" style={{ marginTop: 8 }}>
                          Pane buttons
                        </div>
                        {PANE_BUTTONS.map((b) => (
                          <div key={b.name} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                            <b.icon size={14} strokeWidth={2} aria-hidden="true" style={{ flex: 'none', alignSelf: 'center' }} />
                            <span>
                              {b.name}: {b.what}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                  <div className="keys-col" data-testid="keys-mouse">
                    <div className="pop-head">Mouse</div>
                    {EVERY_MODE_GESTURES.map(([g, what]) => (
                      <div key={g}>
                        {g}: {what}
                      </div>
                    ))}
                    {MODE_GESTURES[gestureMode].map((p) => (
                      <div key={p.pane ?? 'all'}>
                        {p.pane && <div className="keys-sub">{p.pane}</div>}
                        {p.lines.map(([g, what]) => (
                          <div key={g}>
                            {g}: {what}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Help: this mode's reading guide (manual chapter 8), the user manual, as pages this
              viewer's own origin serves (manual/, rendered from docs/ at build time), then the
              About page, the Cite dialogue, the legal page, and the repository. The website opens
              the pages in a new tab; the repo build and the desktop app in the drawer beside the
              viewer. Nothing is fetched from anywhere else. */}
          <div ref={helpMenuRef} style={{ position: 'relative' }}>
            <button
              className="ctl"
              aria-expanded={helpMenu}
              aria-haspopup="menu"
              onClick={() => setHelpMenu((v) => !v)}
              onKeyDown={(e) => onMenuButtonKeyDown(e, helpMenu, setHelpMenu, helpPanelRef)}
              title={
                manualInTab
                  ? 'help: the reading guide for this mode and the user manual, served by this site, in a new tab'
                  : 'help: the reading guide for this mode and the user manual, in a drawer beside the viewer'
              }
            >
              Help
            </button>
            {helpMenu && (
              <div ref={helpPanelRef} className="menu-panel" role="menu" aria-label="Help" onKeyDown={onMenuKeyDown} style={{ right: 0, minWidth: 240 }}>
                {(
                  [
                    [
                      guidePage(viewMode, isXray),
                      isXray ? '2D radiographs, in the manual' : `${VIEW_MODES.find(([m]) => m === viewMode)?.[1] ?? viewMode} reading guide`,
                    ],
                    ['index.html', 'User manual'],
                  ] as const
                ).map(([page, label]) =>
                  manualInTab ? (
                    <a
                      key={page}
                      className="menu-item"
                      role="menuitem"
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
                      role="menuitem"
                      onClick={() => {
                        setManualPage(page);
                        setHelpMenu(false);
                      }}
                    >
                      {label}
                    </button>
                  ),
                )}
                <div role="separator" style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                {siteLink('about', 'About CBCTScope', 'what CBCTScope is, who made it, how to cite it, the licence')}
                {citation && (
                  <button
                    className="menu-item"
                    role="menuitem"
                    title="the reference and a BibTeX entry, from the repository's CITATION.cff, with copy buttons"
                    onClick={() => {
                      setHelpMenu(false);
                      setCiteOpen(true);
                    }}
                  >
                    Cite this software
                  </button>
                )}
                {siteLink('legal', 'Legal notice', 'who publishes this site, privacy, research use, licence and warranty')}
                <a
                  className="menu-item"
                  role="menuitem"
                  href={REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="the source code, the releases and the project page"
                  onClick={() => setHelpMenu(false)}
                >
                  Source code repository
                </a>
              </div>
            )}
          </div>
          {/* the opt-in in-page navigation agent (web build and desktop app): the plain Agent
              button opens its strip under the viewer */}
          {IS_WEB && <AgentToggle />}
          {/* the desktop app's installers, offered in a plain browser only: a menu of direct
              links (components/downloads.ts), the visitor's own system first, read from the user
              agent when the menu opens (it never opens in the static export). Every entry is a
              link the reader clicks; opening the menu requests nothing. */}
          {IS_WEB && !inShell && (
            <div ref={dlMenuRef} style={{ position: 'relative' }}>
              <button
                className="ctl"
                aria-expanded={dlMenu}
                aria-haspopup="menu"
                aria-label="Download the desktop app"
                onClick={() => setDlMenu((v) => !v)}
                onKeyDown={(e) => onMenuButtonKeyDown(e, dlMenu, setDlMenu, dlPanelRef)}
                title="the desktop app for macOS and Windows, with agent control over MCP: direct downloads from the latest release"
              >
                <span className="dl-long">Download the desktop app</span>
                <span className="dl-short">Desktop app</span>
              </button>
              {dlMenu && (
                <div
                  ref={dlPanelRef}
                  className="menu-panel"
                  role="menu"
                  aria-label="Download the desktop app"
                  onKeyDown={onMenuKeyDown}
                  style={{ right: 0, minWidth: 260 }}
                >
                  {downloadEntries(navigator.userAgent).map((entry) =>
                    entry.kind === 'note' ? (
                      <div
                        key="note"
                        data-testid="download-note"
                        style={{ padding: '4px 10px 8px', color: 'var(--text)', lineHeight: 1.5, maxWidth: 300, whiteSpace: 'normal' }}
                      >
                        {entry.text}
                      </div>
                    ) : (
                      <React.Fragment key={entry.href}>
                        {entry.href === RELEASES_URL && (
                          <div role="separator" style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                        )}
                        <a
                          className="menu-item"
                          role="menuitem"
                          href={entry.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={entry.title}
                          onClick={() => setDlMenu(false)}
                        >
                          {entry.label}
                        </a>
                      </React.Fragment>
                    ),
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', order: 2 }}>
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
                void onOpenFolder();
              }}
            />
          )}
          {marksBusy ? (
            // a solid centred panel, like every loading state: nothing behind it dims
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div
                role="status"
                style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--ctl-border)',
                  borderRadius: 'var(--ctl-radius)',
                  padding: '12px 16px',
                  color: 'var(--text)',
                }}
              >
                Loading the marks…
              </div>
            </div>
          ) : error ? (
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ color: 'var(--warn)' }}>{error}</div>
              <button
                className="ctl"
                onClick={() => setError(null)}
                title="clear the error and remount the room. A transient load failure retries."
              >
                Retry
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
          className="rail"
          style={{
            width: 240,
            flex: '0 0 240px',
            borderLeft: '1px solid var(--border)',
            background: 'var(--panel)',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            overflowY: 'auto',
          }}
        >
          {viewMode === 'mpr' && !isXray && (
          <section>
            <div className="rail-head">Tool (1–9, 0, W)</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {TOOL_ORDER.map((m, i) => (
                <button
                  key={m}
                  {...chip(controls.toolMode === m)}
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
              <label className="rail-label" style={{ marginTop: 8 }}>
                Box depth {controls.roi3dDepth} mm (into the slice, centered on it)
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
            <div className="rail-note" style={{ marginTop: 4 }}>
              Arrow and Text ask for a label. Rect and Ellipse report density (HU) stats. Freehand:
              an open stroke gives a curved-path length in mm, a closed loop gives region stats. 3D
              ROI: drag a box to get volume and density stats. Del deletes the selected object.
            </div>
          </section>
          )}

          <section>
            <div className="rail-head">
              Window {isXray ? '(gray, 0-4095)' : '(HU)'}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
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
                    {...chip(active)}
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
            <label className="rail-label">
              Center {voiKnown ? voiShown.center : ''}
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
            <label className="rail-label">
              Width {voiKnown ? voiShown.width : ''}
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
            <label className="rail-label">
              Gamma {controls.gamma.toFixed(2)} (curve between the cut points; 1 = linear)
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
            <label className="rail-check">
              <input
                type="checkbox"
                checked={controls.invert}
                onChange={(e) => setControls((c) => ({ ...c, invert: e.target.checked }))}
              />
              Invert
            </label>
          </section>

          {viewMode === 'mpr' && !isXray && (
          <section>
            <div className="rail-head">Slab / MIP</div>
            {(['axial', 'sagittal', 'coronal'] as MprPane[]).map((p) => (
              <label key={p} className="rail-label">
                {p[0].toUpperCase() + p.slice(1)} {controls.slabByPane[p].toFixed(1)} mm
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
            <label className="rail-check">
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
            <div className="rail-head">3D render</div>
            {/* the house styles as one-click chips, then one library preset, Air, applied as-is */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
              {Object.entries(RENDER_STYLES).map(([value, d]) => (
                <button
                  key={value}
                  {...chip(r3d.style === value)}
                  onClick={() => pickStyle(value)}
                  title={d.group === 'cbct' ? `${d.label}, CBCT-tuned` : d.label}
                >
                  {d.label.replace('CBCT · ', '')}
                </button>
              ))}
              <button
                {...chip(r3d.style === AIR_PRESET)}
                onClick={() => pickStyle(AIR_PRESET)}
                title="Air: the library's air preset, applied as it is. The adjust sliders do not apply to it."
              >
                Air
              </button>
            </div>
            {styleDef ? (
              <>
                {histogram && (
                  <div style={{ marginBottom: 8 }}>
                    <CbctHistogram
                      data={histogram}
                      threshold={r3d.threshold}
                      onThreshold={(hu) => setR3d({ threshold: hu })}
                      defaults={{ threshold: styleDef.defaultThreshold }}
                    />
                  </div>
                )}
                <label className="rail-label">
                  Cut-off threshold {r3d.threshold} HU (densities below stay transparent)
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
                <label className="rail-label">
                  Transparency {r3d.transparency}%
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
                <label className="rail-label">
                  Contrast {r3d.contrast}
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
                <label className="rail-label">
                  Brightness {r3d.brightness}
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
                <label className="rail-check">
                  Pseudo-color
                  <select
                    value={r3d.pseudo}
                    onChange={(e) => setR3d({ pseudo: e.target.value as PseudoKey })}
                    style={{
                      flex: 1,
                      height: 'var(--ctl-h)',
                      background: 'var(--panel-2)',
                      border: '1px solid var(--ctl-border)',
                      borderRadius: 'var(--ctl-radius)',
                      padding: '0 8px',
                      fontSize: 'var(--fs-meta)',
                    }}
                  >
                    {(['none', 'hot', 'cool', 'rainbow'] as PseudoKey[]).map((p) => (
                      <option key={p} value={p}>
                        {p[0].toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="rail-label">
                  Depth enhancement {r3d.depthEnhance} (flat interiors fade, surfaces pop)
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
                <label className="rail-check">
                  <input
                    type="checkbox"
                    checked={r3d.smooth3d}
                    onChange={(e) => setR3d({ smooth3d: e.target.checked })}
                  />
                  Smooth 3D surface (denoised copy; slice views stay untouched)
                </label>
                <label className="rail-check">
                  <input
                    type="checkbox"
                    checked={r3d.cinematic}
                    onChange={(e) => setR3d({ cinematic: e.target.checked })}
                  />
                  Cinematic light (soft in-volume shadows; slower to orbit)
                </label>
                <label className="rail-check">
                  <input
                    type="checkbox"
                    checked={r3d.lightFollow}
                    onChange={(e) => setR3d({ lightFollow: e.target.checked })}
                  />
                  Light follows the camera (uncheck for a fixed light direction)
                </label>
                {!r3d.lightFollow && (
                  <>
                    <label className="rail-label">
                      Light around {r3d.lightAz}° (0 = from the front)
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
                    <label className="rail-label">
                      Light height {r3d.lightEl}° (+ = from above)
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
                <label className="rail-check">
                  <input
                    type="checkbox"
                    checked={r3d.stOverlay}
                    onChange={(e) => setR3d({ stOverlay: e.target.checked })}
                  />
                  Soft-tissue overlay (skin-toned shell under the cut-off)
                </label>
                {r3d.stOverlay && (
                  <>
                    <label className="rail-label">
                      Tissue threshold {r3d.stThreshold} HU
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
                    <label className="rail-label">
                      Tissue opacity {r3d.stOpacity}%
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
              <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--text)', marginBottom: 4 }}>
                Air is applied as it is. The adjust sliders work on the other styles only.
              </div>
            )}
            <label className="rail-check">
              <input
                type="checkbox"
                checked={r3d.perspective}
                onChange={(e) => setR3d({ perspective: e.target.checked })}
              />
              Perspective projection (off = orthographic; toggling re-homes the 3D camera)
            </label>
            <label className="rail-check">
              <input
                type="checkbox"
                checked={controls.planes3d}
                onChange={(e) => setControls((c) => ({ ...c, planes3d: e.target.checked }))}
              />
              Plane indicators: the three section planes and the bounding box inside the render
            </label>
          </section>
          )}

          {viewMode === 'mpr' && !isXray && (
          <section>
            <div className="rail-head">
              Crop 3D (render only; slices unaffected)
            </div>
            {(
              [
                ['x', 'R to L'],
                ['y', 'A to P'],
                ['z', 'I to S'],
              ] as [keyof Crop3d, string][]
            ).map(([axis, label]) => (
              <div key={axis} style={{ marginBottom: 4 }}>
                <div className="rail-label">
                  {label}: keep {Math.round(controls.crop3d[axis][0] * 100)} to{' '}
                  {Math.round(controls.crop3d[axis][1] * 100)}%
                </div>
                <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
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
                      style={{ flex: '1 1 0', width: 0, minWidth: 0 }}
                    />
                  ))}
                </div>
              </div>
            ))}
            <button
              className="ctl ctl-wide" style={{ marginTop: 8 }}
              onClick={() =>
                setControls((c) => ({
                  ...c,
                  crop3d: { x: [0, 1], y: [0, 1], z: [0, 1] },
                  clearCutsNonce: c.clearCutsNonce + 1,
                }))
              }
              title="full volume back in the render: crop box reset + the right-drag cut removed"
            >
              Un-crop and clear cuts
            </button>
          </section>
          )}

          {viewMode === 'mpr' && !isXray && (
          <section>
            <div className="rail-head">My 3D presets</div>
            {savedPresets.map((p) => (
              <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <button
                  className="ctl"
                  style={{ flex: '1 1 0', minWidth: 0, justifyContent: 'flex-start', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onClick={() => setControls((c) => ({ ...c, render3d: { ...DEFAULT_RENDER3D, ...p.settings } }))}
                  title="apply this saved style"
                >
                  {p.name}
                </button>
                <button
                  {...chip(defaultPreset === p.name)}
                  onClick={() => toggleDefaultPreset(p.name)}
                  title={defaultPreset === p.name ? 'default on app start. Click to unset.' : 'set as the default on app start'}
                  style={{ padding: '0 8px' }}
                >
                  Default
                </button>
                <button className="ctl" onClick={() => deletePreset(p.name)} title="delete this saved style" style={{ padding: '0 8px' }}>
                  Delete
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') savePreset();
                }}
                placeholder="Name the current look…"
                aria-label="Preset name"
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 'var(--ctl-h)',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--ctl-border)',
                  borderRadius: 'var(--ctl-radius)',
                  padding: '0 8px',
                  fontSize: 'var(--fs-meta)',
                  color: 'var(--text)',
                }}
              />
              <button className="ctl" onClick={savePreset} disabled={!presetName.trim()}>
                Save
              </button>
            </div>
          </section>
          )}

          {viewMode === 'mpr' && !isXray && (
          <section>
            <label className="rail-check">
              <input
                type="checkbox"
                checked={controls.planeLines}
                onChange={(e) => setControls((c) => ({ ...c, planeLines: e.target.checked }))}
              />
              Plane lines (C), synced on all three views
            </label>
            <label className="rail-check">
              <input
                type="checkbox"
                checked={controls.showOverlay}
                onChange={(e) => setControls((c) => ({ ...c, showOverlay: e.target.checked }))}
              />
              Show overlays (O): lines, measurements, labels
            </label>
            <button
              className="ctl ctl-wide" style={{ marginBottom: 8 }}
              onClick={() => setControls((c) => ({ ...c, resetNonce: c.resetNonce + 1 }))}
              title="Cameras back to orthogonal. Window and everything else untouched (R)."
            >
              Reset orientation (R)
            </button>
            <button
              className="ctl ctl-wide"
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
                className="ctl ctl-wide" style={{ marginBottom: 8 }}
                onClick={() => setControls((c) => ({ ...c, resetNonce: c.resetNonce + 1 }))}
                title="Fit the radiograph to the pane. Window untouched (R)."
              >
                Fit to pane (R)
              </button>
              <button
                className="ctl ctl-wide"
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

          <div className="rail-note">
            {isXray
              ? 'Radiograph: the wheel zooms about the cursor, left-drag pans, double-click or R refits. Gray values are display-normalized (0-4095): window them via the histogram or sliders; they are not HU.'
              : 'Measurements are true anatomical mm (isotropic voxels): unlike pano mm, no projection magnification. Crosshairs: drag the lines to re-slice; wheel scrolls the hovered pane.'}
          </div>
        </aside>
        {/* the user manual's drawer: a column of this row, so it narrows the viewer and covers nothing */}
        {manualPage !== null && <ManualDrawer page={manualPage} onClose={() => setManualPage(null)} />}
        {citeOpen && citation && <CiteDialog citation={citation} onClose={() => setCiteOpen(false)} />}
      </div>
      {/* the status line: the case facts, the first-run line while the phantom is on screen and
          nothing of the reader's is open (it leaves by itself once an export is opened), and the
          gesture legend of this mode. Always visible, full contrast for the facts and the link. */}
      <div className="status-line" data-testid="status-line" style={{ order: 2 }}>
        {current && (
          <span className="status-facts">
            {/* the case identity leads, the id everything else (exports, sidecars) is filed
                under; the phantom is named once, in the volume list */}
            {isDemoVol(current.anon)
              ? ''
              : `${(isFusedVol(current.anon) || isLocalVol(current.anon)) && current.label ? current.label : current.anon} · `}
            {volLabel(current)} ·{' '}
            {current.kind === 'mf' ? 'multiframe' : current.kind === 'xray' ? 'radiograph' : 'slices'} ·{' '}
            {(current.spacing[0] * 1000).toFixed(0)} µm {current.kind === 'xray' ? 'pixels' : 'voxels'}
          </span>
        )}
        {current && isDemoVol(current.anon) && !srcLabel && (
          <span style={{ color: 'var(--text)' }} data-testid="first-run">
            Built in, no patient data.{' '}
            {IS_WEB && !inShell ? 'Your scan is read in this tab and never uploaded.' : 'Your scan is read on this computer and never uploaded.'}{' '}
            <a href={STILLS_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)' }}>
              See CBCTScope on a real scan
            </a>
          </span>
        )}
        <span className="status-legend" data-testid="status-legend">
          {legend}
        </span>
      </div>
    </div>
  );
}
