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
  | { kind: 'files'; files: File[]; label?: string; /** a drop walk that stopped early says why */ walkStopped?: string }
  | { kind: 'native'; chooser: 'folder' | 'file' };

/**
 * A refusal may carry what the scan saw: how many files it read and why none of them opened
 * (the browser scanner fills these; the server's chooser gives the error alone).
 */
export type OpenResult =
  | { ok: true; label: string; count: number }
  | { ok: false; error: string; scanned?: number; reasons?: string[] };

/**
 * What an open is doing, from the moment the files are handed over until the volume is on
 * screen: reading headers (done/total files), assembling the volume (done/total percent),
 * preparing the display (from assembly done until the first frame).
 */
export interface OpenProgress {
  phase: 'scan' | 'assemble' | 'display';
  done: number;
  total?: number;
}
export type OpenProgressFn = (p: OpenProgress) => void;

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
  /**
   * Open files or the native chooser. `onProgress` reports the header scan and, after the
   * open resolves, the first assembly of an opened volume ('assemble', then 'display' when
   * the voxels are in). The server's chooser ignores it.
   */
  open(input: SourceInput, onProgress?: OpenProgressFn): Promise<OpenResult>;
  close(): Promise<void>;
  registerFused(meta: FusedMeta, voxels: Int16Array): Promise<{ anon: string }>;
  getEvidence(anon: string): Promise<EvidenceFile | null>;
  putEvidence(file: EvidenceFile): Promise<boolean>;
}
