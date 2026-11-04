// BROWSER. In-tab registry of stitched (fused) volumes, mirroring lib/server/fused.ts: a fusion
// is baked client-side and registered here under a `fused_<12 hex>` id so every view reads it
// through the same contract as opened volumes. Memory only: fused volumes are derived and
// reproducible from their parents, so they are never written anywhere. Same LRU cap as the
// server (3); listed newest first.
import type { CbctVolumeMeta, VoxelVolume } from '../shared/dicom';
import type { FusedMeta, ListEntry } from './volumeSource';

export const FUSED_ID_RE = /^fused_[0-9a-f]{12}$/;
export const isFusedId = (id: string) => FUSED_ID_RE.test(id);

const LRU_MAX = 3;

interface FusedEntry {
  meta: CbctVolumeMeta;
  voxels: Int16Array;
  label: string;
}

function randomHex12(): string {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function createFusedStore() {
  const store = new Map<string, FusedEntry>();

  return {
    register(input: FusedMeta, voxels: Int16Array): { anon: string; label: string } {
      let anon = `fused_${randomHex12()}`;
      while (store.has(anon)) anon = `fused_${randomHex12()}`;
      const [nx, , nz] = input.dims;
      const meta: CbctVolumeMeta = {
        anon,
        kind: 'mf',
        dims: input.dims,
        spacing: input.spacing,
        fov: [Math.round((nx * input.spacing[0]) / 10), Math.round((nz * input.spacing[2]) / 10)],
        region: 'fused',
        year: input.year || '',
        pair: null,
        origin: input.origin,
        defaultVoi: input.defaultVoi,
        bytes: voxels.byteLength,
      };
      store.set(anon, { meta, voxels, label: input.label });
      while (store.size > LRU_MAX) store.delete(store.keys().next().value as string);
      return { anon, label: input.label };
    },

    get(anon: string): VoxelVolume | null {
      const hit = store.get(anon);
      return hit ? { meta: hit.meta, voxels: hit.voxels } : null;
    },

    list(): ListEntry[] {
      return [...store.values()].reverse().map((e) => ({
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
    },
  };
}

export type FusedStore = ReturnType<typeof createFusedStore>;
