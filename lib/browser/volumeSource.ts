// The source seam (docs/web-build.md, section 4). Every client file that needs volumes,
// the opened source, fused registrations or evidence sidecars talks to this interface, never
// to /api/... directly. Two implementations: serverSource (the repo: today's fetches to the
// loopback server) and browserSource (the web build and the packaged app: the browser reads
// the files the clinician opens; nothing leaves the tab).
import type { CbctListEntry, CbctVolumeMeta } from '@/lib/shared/dicom';
import type { EvidenceFile } from '@/components/cbct/evidence';

/** a catalog row: geometry plus the display label (opened volumes and the phantom carry one) */
export type ListEntry = CbctListEntry & { label: string };

/** what "open" receives: files from the browser's picker or a drop, or the server's native chooser */
export type SourceInput =
  | { kind: 'files'; files: File[]; label?: string }
  | { kind: 'native'; chooser: 'folder' | 'file' };

export type OpenResult = { ok: true; label: string; count: number } | { ok: false; error: string };

/** the geometry a stitch bakes alongside its voxels (mirrors the fused route's header) */
export interface FusedMeta {
  dims: [number, number, number];
  spacing: [number, number, number];
  origin: [number, number, number];
  defaultVoi: { center: number; width: number };
  label: string;
  year: string;
}

export interface VolumeSource {
  /** openable volumes: fused, then opened, then the phantom */
  list(): Promise<ListEntry[]>;
  meta(anon: string): Promise<CbctVolumeMeta>;
  /** Int16 LE HU voxels, x-fastest, y, z-ascending */
  data(anon: string, onProgress?: (fraction: number) => void): Promise<Int16Array>;
  /** the opened source: label and count, or null when nothing is open */
  opened(): Promise<{ label: string; count: number } | null>;
  open(input: SourceInput): Promise<OpenResult>;
  close(): Promise<void>;
  registerFused(meta: FusedMeta, voxels: Int16Array): Promise<{ anon: string }>;
  getEvidence(anon: string): Promise<EvidenceFile | null>;
  putEvidence(file: EvidenceFile): Promise<boolean>;
}
