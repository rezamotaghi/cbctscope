// SERVER-ONLY. Shared DICOM addressing + volume-contract types for the CBCT viewer.
//
// Every volume source (opened local export, session-fused stitch, synthetic demo phantom) is
// normalized into ONE contract for the browser: the assembler emits Int16 HU voxels (rescale
// baked in), x-fastest / y / z-ASCENDING order, plus a geometry JSON. The browser never parses
// DICOM itself.
import type dicomParser from 'dicom-parser';

/** Any servable volume id: user-opened local volumes, session-fused stitches, or the demo phantom. */
export const VOLUME_ID_RE = /^(local|fused|demo)_[0-9a-f]{12}$/;

export interface CbctListEntry {
  /** stable volume id (see VOLUME_ID_RE) */
  anon: string;
  kind: 'mf' | 'slices';
  dims: [number, number, number]; // cols, rows, slices
  spacing: [number, number, number];
  fov: [number, number]; // axial cm, z cm
  region: string;
  year: string;
  /** reserved for paired reconstructions of one acquisition; always null for opened volumes */
  pair: string | null;
}

export interface CbctVolumeMeta extends CbctListEntry {
  origin: [number, number, number];
  /** robust default window (HU) from the middle slice */
  defaultVoi: { center: number; width: number };
  bytes: number;
}

export interface AssembledVolume {
  meta: CbctVolumeMeta;
  /** Int16 LE HU voxels, x-fastest, y, z-ascending */
  data: Buffer;
}

/** tag helpers (dicom-parser addressing) — shared across the source scanners */
export const TAG = {
  rows: 'x00280010',
  cols: 'x00280011',
  frames: 'x00280008',
  ipp: 'x00200032',
  intercept: 'x00281052',
  slope: 'x00281053',
  pixelData: 'x7fe00010',
  perFrameFG: 'x52009230',
  planePosSeq: 'x00209113',
} as const;

export function ippZ(ds: dicomParser.DataSet): number {
  const s = ds.string(TAG.ipp) ?? '';
  const parts = s.split('\\');
  return Number(parts[2] ?? 0);
}

export function ippVec(ds: dicomParser.DataSet): [number, number, number] {
  const parts = (ds.string(TAG.ipp) ?? '0\\0\\0').split('\\').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** Aligned Uint16 view over a byte range (copies — fs buffers are not 2-byte aligned in general). */
export function u16Copy(buf: Buffer, offset: number, byteLen: number): Uint16Array {
  const copy = Buffer.alloc(byteLen);
  buf.copy(copy, 0, offset, offset + byteLen);
  return new Uint16Array(copy.buffer, 0, byteLen / 2);
}

export function robustVoi(slice: Int16Array): { center: number; width: number } {
  // stride-sampled percentile window over one axial slice — cheap, good-enough default
  const sample: number[] = [];
  for (let i = 0; i < slice.length; i += 7) sample.push(slice[i]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.01)];
  const hi = sample[Math.floor(sample.length * 0.995)];
  const width = Math.max(hi - lo, 100);
  return { center: Math.round(lo + width / 2), width: Math.round(width) };
}
