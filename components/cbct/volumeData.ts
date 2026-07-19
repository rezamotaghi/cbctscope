'use client';
// Shared client-side CBCT volume data: fetch + cache of the normalized Int16 HU buffer from
// /api/cbct. Used by BOTH CbctViewport (Cornerstone volume rendering) and CbctPano (direct
// CPU curved-reformat sampling). Pure fetch/cache — no Cornerstone imports here.

export interface CbctMeta {
  anon: string;
  /** 'mf' | 'slices' = CBCT volume · 'xray' = single 2D radiograph (dims [cols, rows, 1]) */
  kind: 'mf' | 'slices' | 'xray';
  dims: [number, number, number]; // cols(x), rows(y), slices(z)
  spacing: [number, number, number];
  origin: [number, number, number];
  fov: [number, number];
  region: string;
  year: string;
  pair: string | null;
  defaultVoi: { center: number; width: number };
  bytes: number;
}

export interface VolumeEntry {
  meta: CbctMeta;
  /** Int16 HU voxels, x-fastest / y / z-ascending */
  scalar: Int16Array;
}

// an ARA pair stays resident so the toggle is instant
const volCache = new Map<string, VolumeEntry>();
const inflight = new Map<string, Promise<VolumeEntry>>();

export function getCachedVolume(anon: string): VolumeEntry | undefined {
  return volCache.get(anon);
}

export function keepOnly(anons: (string | null)[]): string[] {
  const keep = new Set(anons.filter(Boolean) as string[]);
  const evicted: string[] = [];
  for (const key of [...volCache.keys()]) {
    if (!keep.has(key)) {
      volCache.delete(key);
      evicted.push(key);
    }
  }
  return evicted;
}

export function clearVolumeCache(): void {
  volCache.clear();
}

export function reinsert(anon: string, entry: VolumeEntry): void {
  volCache.set(anon, entry);
}

export async function loadVolumeData(
  anon: string,
  onProgress?: (f: number) => void,
): Promise<VolumeEntry> {
  const hit = volCache.get(anon);
  if (hit) return hit;
  const pending = inflight.get(anon);
  if (pending) return pending;
  const p = (async () => {
    const metaRes = await fetch(`/api/cbct/${anon}`);
    if (!metaRes.ok) throw new Error('metadata fetch failed');
    const meta = (await metaRes.json()) as CbctMeta;
    const dataRes = await fetch(`/api/cbct/${anon}/data`);
    if (!dataRes.ok || !dataRes.body) throw new Error('voxel fetch failed');
    const total = Number(dataRes.headers.get('Content-Length') || meta.bytes);
    const raw = new Uint8Array(total);
    const reader = dataRes.body.getReader();
    let off = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw.set(value, off);
      off += value.length;
      onProgress?.(off / total);
    }
    const scalar = new Int16Array(raw.buffer, 0, Math.floor(total / 2)); // 16-bit end-to-end
    const entry = { meta, scalar };
    volCache.set(anon, entry);
    while (volCache.size > 2) volCache.delete(volCache.keys().next().value as string);
    return entry;
  })();
  inflight.set(anon, p);
  try {
    return await p;
  } finally {
    inflight.delete(anon);
  }
}
