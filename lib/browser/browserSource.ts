// BROWSER. The VolumeSource of the web build and the packaged app (docs/web-build.md, sections
// 4 and 5): the browser reads the files the clinician opens and nothing leaves the tab.
//   - list: fused (newest first), then the opened volumes, then the synthetic phantom
//   - open: scans File objects (scan.ts); the native chooser exists only on the server. Its
//     progress callback hears the scan, then the first assembly of an opened volume, then
//     'display' when those voxels are in (the viewer ends the display phase on its first frame)
//   - meta: cheap for an opened volume (assemble.ts volumeMeta: the scan's geometry, the
//     header's origin, the window from one middle slice), never an assembly
//   - data: assembly runs in a module Web Worker (assemble.worker.ts) and the voxel buffer is
//     transferred back, with progress. Nothing assembled stays here: volumeData.ts's cache is
//     the only cache, so its keepOnly() really frees memory. What is kept: the in-flight
//     promise (a second request during an assembly joins it) and the open's one-shot progress
//     reporter for the first assembly it leads to. The phantom is generated in the same worker
//     on first request and kept for the tab
//   - registerFused: the in-tab registry (fusedStore.ts)
//   - evidence: IndexedDB (evidenceStore.ts), degrading to "no sidecar"
import type { CbctVolumeMeta, VoxelVolume } from '../shared/dicom';
import { PHANTOM_ENTRY, PHANTOM_LABEL, isPhantomId } from '../shared/phantom';
import { assemble, volumeMeta, type AssembleJob, type Progress } from './assemble';
import type { WorkerReply, WorkerRequest } from './assemble.worker';
import { createEvidenceStore, type KeyValueAdapter } from './evidenceStore';
import { createFusedStore, isFusedId } from './fusedStore';
import { scanFiles, type BrowserVolume } from './scan';
import type { ListEntry, OpenProgressFn, VolumeSource } from './volumeSource';

/** runs one assembly job; the worker in the page, assemble() directly in tests */
export type AssemblyRunner = (job: AssembleJob, onProgress?: Progress) => Promise<VoxelVolume>;

/** Direct, same-thread assembly: tests, and the fallback when a Worker cannot start. */
export const directRunner: AssemblyRunner = (job, onProgress) => assemble(job, onProgress);

/** The module-worker runner. Falls back to directRunner when Worker is missing or fails to load. */
export function workerRunner(): AssemblyRunner {
  let worker: Worker | null = null;
  let broken = typeof Worker === 'undefined';
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (v: VoxelVolume) => void; reject: (e: Error) => void; onProgress?: Progress }
  >();

  const start = (): Worker | null => {
    if (worker || broken) return worker;
    try {
      worker = new Worker(new URL('./assemble.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      broken = true;
      return null;
    }
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const msg = e.data;
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') p.onProgress?.(msg.fraction);
      else {
        pending.delete(msg.id);
        if (msg.type === 'done') p.resolve({ meta: msg.meta, voxels: msg.voxels });
        else p.reject(new Error(msg.message));
      }
    };
    worker.onerror = () => {
      // the worker script itself failed: fail what is in flight, assemble on this thread from now on
      broken = true;
      worker?.terminate();
      worker = null;
      for (const p of pending.values()) p.reject(new Error('assembly worker failed to start'));
      pending.clear();
    };
    return worker;
  };

  return (job, onProgress) => {
    const w = start();
    if (!w) return directRunner(job, onProgress);
    const id = nextId++;
    return new Promise<VoxelVolume>((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      w.postMessage({ id, job } satisfies WorkerRequest);
    });
  };
}

export interface BrowserSourceOptions {
  runner?: AssemblyRunner;
  /** storage under the evidence sidecars; IndexedDB when omitted */
  evidence?: KeyValueAdapter;
}

/** resolves after the next paint in a page; at once where there is no frame loop (tests) */
const nextPaint = (): Promise<void> =>
  typeof requestAnimationFrame === 'function'
    ? new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    : Promise.resolve();

export function createBrowserSource(opts: BrowserSourceOptions = {}): VolumeSource {
  const runner = opts.runner ?? workerRunner();
  const fused = createFusedStore();
  const evidence = createEvidenceStore(opts.evidence);

  let opened: { label: string; volumes: BrowserVolume[] } | null = null;
  let generation = 0; // bumps on every open/close so a stale assembly is not cached
  let phantom: Promise<VoxelVolume> | null = null;
  /** cheap metadata of opened volumes, per generation (no voxels) */
  const metas = new Map<string, Promise<CbctVolumeMeta>>();
  const inflight = new Map<string, Promise<VoxelVolume>>();
  /** progress listeners per in-flight assembly: meta() starts it, data() joins it later */
  const listeners = new Map<string, Set<Progress>>();
  /** the last open's reporter, for the first assembly it leads to; one-shot */
  let reporter: { gen: number; fn: OpenProgressFn } | null = null;

  const dropLocal = () => {
    generation++;
    metas.clear();
    inflight.clear();
    listeners.clear();
    reporter = null;
  };

  function volume(anon: string, onProgress?: Progress): Promise<VoxelVolume> {
    if (isFusedId(anon)) {
      const hit = fused.get(anon);
      return hit
        ? Promise.resolve(hit)
        : Promise.reject(new Error(`fused volume ${anon} not in memory (session-scoped: re-stitch)`));
    }
    if (isPhantomId(anon)) {
      if (!phantom) {
        phantom = runner({ kind: 'phantom' }, onProgress);
        phantom.catch(() => {
          phantom = null; // let the next request try again
        });
      }
      return phantom;
    }
    const pending = inflight.get(anon);
    if (pending) {
      if (onProgress) listeners.get(anon)?.add(onProgress);
      return pending;
    }
    const v = opened?.volumes.find((x) => x.id === anon);
    if (!v) return Promise.reject(new Error('unknown volume'));
    const gen = generation;
    const fans = new Set<Progress>(onProgress ? [onProgress] : []);
    listeners.set(anon, fans);
    // the open that led here hears this assembly, once
    const lead = reporter && reporter.gen === gen ? reporter.fn : null;
    if (lead) {
      reporter = null;
      lead({ phase: 'assemble', done: 0, total: 100 });
    }
    const fanOut: Progress = (fraction) => {
      for (const l of fans) l(fraction);
      lead?.({ phase: 'assemble', done: Math.round(fraction * 100), total: 100 });
    };
    const p = runner({ kind: 'volume', volume: v }, fanOut).then(async (vol) => {
      if (lead) {
        lead({ phase: 'display', done: 0 });
        // let the panel paint "Preparing the display" before the viewer's synchronous upload
        // of the voxels to the renderer holds the main thread
        await nextPaint();
      }
      return vol;
    });
    inflight.set(anon, p);
    const clear = () => {
      if (inflight.get(anon) === p) inflight.delete(anon);
      if (listeners.get(anon) === fans) listeners.delete(anon);
    };
    p.then(clear, clear);
    return p;
  }

  return {
    async list(): Promise<ListEntry[]> {
      const local: ListEntry[] = (opened?.volumes ?? []).map((v) => ({
        anon: v.id,
        kind: v.kind,
        dims: v.dims,
        spacing: v.spacing,
        fov: v.fov,
        region: '',
        year: v.year,
        pair: null,
        label: v.label,
      }));
      const ph: ListEntry = {
        ...PHANTOM_ENTRY,
        dims: [...PHANTOM_ENTRY.dims],
        spacing: [...PHANTOM_ENTRY.spacing],
        fov: [...PHANTOM_ENTRY.fov],
        label: PHANTOM_LABEL,
      };
      return [...fused.list(), ...local, ph];
    },

    async meta(anon: string): Promise<CbctVolumeMeta> {
      if (isFusedId(anon) || isPhantomId(anon)) return (await volume(anon)).meta;
      const v = opened?.volumes.find((x) => x.id === anon);
      if (!v) throw new Error('unknown volume');
      let m = metas.get(anon);
      if (!m) {
        m = volumeMeta(v);
        metas.set(anon, m);
        m.catch(() => metas.get(anon) === m && metas.delete(anon));
      }
      return m;
    },

    async data(anon: string, onProgress?: (fraction: number) => void): Promise<Int16Array> {
      return (await volume(anon, onProgress)).voxels;
    },

    async opened() {
      return opened ? { label: opened.label, count: opened.volumes.length } : null;
    },

    async open(input, onProgress) {
      if (input.kind === 'native') return { ok: false, error: 'native chooser is not available in the browser' };
      let scan;
      try {
        scan = await scanFiles(
          input.files,
          input.label,
          onProgress && ((done, total) => onProgress({ phase: 'scan', done, total })),
        );
      } catch (err) {
        // the scanner's own words, never a generic "scan failed"
        return { ok: false, error: err instanceof Error && err.message ? err.message : String(err) || 'the scan stopped' };
      }
      if (!scan.ok) {
        if (input.walkStopped) return { ...scan, reasons: [...(scan.reasons ?? []), input.walkStopped] };
        return scan;
      }
      opened = { label: scan.label, volumes: scan.volumes };
      dropLocal();
      if (onProgress) reporter = { gen: generation, fn: onProgress };
      return { ok: true, label: scan.label, count: scan.volumes.length };
    },

    async close() {
      opened = null;
      dropLocal();
    },

    async registerFused(meta, voxels) {
      return { anon: fused.register(meta, voxels).anon };
    },

    getEvidence: (anon) => evidence.get(anon),
    putEvidence: (file) => evidence.put(file),
  };
}

/** the one instance the web build uses */
export const browserSource: VolumeSource = createBrowserSource();
