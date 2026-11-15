'use client';
// The repo's volume source (docs/web-build.md, section 4): today's fetches to the loopback
// server, behaviour preserved. The only file under components/ besides the SSE agent
// transport that names the server's routes.
import type { CbctVolumeMeta } from '@/lib/server/dicom';
import type { FusedMeta, ListEntry, OpenResult, SourceInput, VolumeSource } from '@/lib/browser/volumeSource';
import { EVIDENCE_SCHEMA, type EvidenceFile } from './evidence';

/**
 * What `open` returns when the reader dismissed the native chooser: not an error, so the
 * shell shows nothing. The seam's OpenResult has no cancel variant; an empty error is the
 * agreed sentinel (see `isCanceled` in ./source).
 */
const CANCELED: OpenResult = { ok: false, error: '' };

/** meta() results by id, so a voxel stream without Content-Length still knows its size */
const metaBytes = new Map<string, number>();

async function meta(anon: string): Promise<CbctVolumeMeta> {
  const res = await fetch(`/api/cbct/${anon}`);
  if (!res.ok) throw new Error('metadata fetch failed');
  const m = (await res.json()) as CbctVolumeMeta;
  metaBytes.set(anon, m.bytes);
  return m;
}

export const serverSource: VolumeSource = {
  async list() {
    // no-store so a just-registered volume is never masked by cache
    const res = await fetch('/api/cbct', { cache: 'no-store' });
    const j = (await res.json()) as { volumes?: ListEntry[] };
    const all = j.volumes ?? [];
    // fused (stitched) volumes first, then opened volumes, then the demo phantom
    return [
      ...all.filter((v) => v.anon.startsWith('fused_')),
      ...all.filter((v) => v.anon.startsWith('local_')),
      ...all.filter((v) => v.anon.startsWith('demo_')),
    ];
  },

  meta,

  async data(anon, onProgress) {
    const res = await fetch(`/api/cbct/${anon}/data`);
    if (!res.ok || !res.body) throw new Error('voxel fetch failed');
    const total = Number(res.headers.get('Content-Length') || metaBytes.get(anon) || (await meta(anon)).bytes);
    const raw = new Uint8Array(total);
    const reader = res.body.getReader();
    let off = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      raw.set(value, off);
      off += value.length;
      onProgress?.(off / total);
    }
    return new Int16Array(raw.buffer, 0, Math.floor(total / 2)); // 16-bit end-to-end
  },

  async opened() {
    const res = await fetch('/api/cbct/source');
    const d = (await res.json()) as { active?: boolean; label?: string | null; count?: number };
    return d.active ? { label: String(d.label), count: Number(d.count ?? 0) } : null;
  },

  async open(input: SourceInput): Promise<OpenResult> {
    // the local app opens scans in place through the native chooser on this machine
    if (input.kind !== 'native') return { ok: false, error: 'the local app opens scans through the native chooser' };
    const res = await fetch('/api/cbct/source/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: input.chooser }),
    });
    const d = (await res.json()) as { canceled?: boolean; error?: string; label?: string; count?: number };
    if (d.canceled) return CANCELED; // the reader dismissed the dialog: not an error
    if (!res.ok || d.error) return { ok: false, error: String(d.error ?? `open failed (${res.status})`) };
    return { ok: true, label: String(d.label), count: Number(d.count ?? 0) };
  },

  async close() {
    try {
      await fetch('/api/cbct/source', { method: 'DELETE' });
    } catch {
      /* server gone: the catalog refetch surfaces it */
    }
  },

  async registerFused(fusedMeta: FusedMeta, voxels: Int16Array) {
    const bytes = new Uint8Array(voxels.buffer as ArrayBuffer, voxels.byteOffset, voxels.byteLength);
    const res = await fetch('/api/cbct/fused', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'x-omfr-fused-meta': JSON.stringify(fusedMeta) },
      body: new Blob([bytes]), // raw Int16 LE voxel bytes
    });
    const j = (await res.json()) as { anon?: string; error?: string };
    if (!res.ok || !j.anon) throw new Error(j.error ?? `bake upload failed (${res.status})`);
    return { anon: j.anon };
  },

  async getEvidence(anon) {
    try {
      const r = await fetch(`/api/cbct/${anon}/evidence`);
      if (!r.ok) return null;
      const j = (await r.json()) as EvidenceFile & { exists?: boolean };
      if (j.exists === false || j.schema !== EVIDENCE_SCHEMA) return null;
      return j;
    } catch {
      return null;
    }
  },

  async putEvidence(file) {
    try {
      const r = await fetch(`/api/cbct/${file.anon}/evidence`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(file),
      });
      return r.ok;
    } catch {
      return false;
    }
  },
};
