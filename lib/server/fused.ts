// SERVER-ONLY. In-memory registry of stitched (fused) CBCT volumes. A fusion is baked
// client-side (register + resample two volumes onto one grid) and POSTed here; we hold it in
// server memory keyed by a `fused_<12hex>` id so every view (MPR, pano, ceph, region, …) reads
// it through the exact same contract as opened volumes, with zero client changes.
// Session-scoped by design: fused volumes are derived, reproducible from their parents, and
// like everything here stay LOCAL, so they are deliberately NOT written to disk. A small LRU
// cap keeps memory bounded.
import crypto from 'node:crypto';
import type { AssembledVolume, CbctListEntry, CbctVolumeMeta } from './dicom';

export const FUSED_ID_RE = /^fused_[0-9a-f]{12}$/;
export function isFusedCbctId(id: string): boolean {
  return FUSED_ID_RE.test(id);
}

export interface FusedInput {
  dims: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  defaultVoi: { center: number; width: number };
  label: string;
  year: string;
  /** raw Int16 LE voxel bytes, x-fastest / y / z-ascending (the browser contract) */
  data: Buffer;
}

interface FusedEntry {
  meta: CbctVolumeMeta;
  data: Buffer;
  label: string;
}

const store = new Map<string, FusedEntry>();
const LRU_MAX = 3;

export function registerFused(input: FusedInput): { anon: string; label: string } {
  const anon = `fused_${crypto.randomBytes(6).toString('hex')}`;
  const [nx, , nz] = input.dims;
  const meta: CbctVolumeMeta = {
    anon,
    kind: 'mf',
    dims: input.dims,
    spacing: input.spacing,
    fov: [
      Math.round((nx * input.spacing[0]) / 10),
      Math.round((nz * input.spacing[2]) / 10),
    ],
    region: 'fused',
    year: input.year || '',
    pair: null,
    origin: input.origin,
    defaultVoi: input.defaultVoi,
    bytes: input.data.byteLength,
  };
  store.set(anon, { meta, data: input.data, label: input.label });
  while (store.size > LRU_MAX) {
    const oldest = store.keys().next().value as string;
    store.delete(oldest);
  }
  return { anon, label: input.label };
}

export function getFusedVolume(anon: string): AssembledVolume {
  const hit = store.get(anon);
  if (!hit) throw new Error(`fused volume ${anon} not in memory (session-scoped — re-stitch)`);
  return { meta: hit.meta, data: hit.data };
}

export function listFusedVolumes(): (CbctListEntry & { label: string })[] {
  return [...store.values()].map((e) => ({
    anon: e.meta.anon,
    kind: e.meta.kind,
    dims: e.meta.dims,
    spacing: e.meta.spacing,
    fov: e.meta.fov,
    region: e.meta.region,
    year: e.meta.year,
    pair: null,
    label: e.label,
  }));
}
