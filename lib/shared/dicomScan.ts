// SHARED (server and browser). The scan rules both loaders apply: the walk and size limits,
// the extra tags, the spacing readers, the display label, and the geometry checks a hostile
// header must pass. No file I/O here: lib/server/localSource.ts reads from disk and
// lib/browser/scan.ts with File.slice, and both call these on the parsed header.
import type dicomParser from 'dicom-parser';
import { TAG, ippZ } from './dicom';

export const MAX_WALK_FILES = 8000;
export const MAX_WALK_DEPTH = 8;
export const HEAD_BYTES = 4 * 1024 * 1024; // first read: covers virtually every header
export const HEAD_RETRY_BYTES = 32 * 1024 * 1024; // retry: giant per-frame functional groups
export const MIN_SLICES = 30; // fewer single-frame files than this is not a CBCT series
export const MIN_MF_FRAMES = 16;
export const MAX_VOLUME_BYTES = 1.5e9; // runaway guard (about 900^2 x 900 slices)

/** extra tags the scanners need beyond the shared TAG set */
export const XTAG = {
  tsUid: 'x00020010',
  sopInstanceUid: 'x00080018',
  modality: 'x00080060',
  studyDate: 'x00080020',
  seriesUid: 'x0020000e',
  pixelSpacing: 'x00280030',
  bitsAllocated: 'x00280100',
  pixelRep: 'x00280103',
  spacingBetween: 'x00180088',
  sliceThickness: 'x00180050',
  sharedFG: 'x52009229',
  pixelMeasures: 'x00289110',
  photometric: 'x00280004',
  imagerPixelSpacing: 'x00181164',
} as const;

export const UNCOMPRESSED_TS = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1']);

/** Single-frame 2D radiograph modalities the scanners accept (panoramic, digital and
 * computed radiography, intraoral). Same uncompressed-16-bit constraint as volumes. */
export const RADIOGRAPH_MODALITIES = new Set(['PX', 'DX', 'CR', 'IO']);

export const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * A count tag (NumberOfFrames) as a positive integer: absent means `fallback`; anything else
 * that is not a whole number above zero ("16.5", "-3", "0", "abc") is null, and the file is
 * refused rather than rounded.
 */
export function positiveIntTag(raw: string | undefined, fallback = 1): number | null {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\s*\+?\d+\s*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Rows and Columns: present, whole and above zero (uint16, so whole by construction) */
export const positiveDim = (v: number | undefined): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/**
 * The pixel bytes a header promises must exist: dataOffset plus the expected byte count may
 * not run past the bytes available. Throws a plain message instead of reading out of range.
 */
export function assertPixelRange(dataOffset: number, expected: number, available: number, what = 'pixel data'): void {
  if (!(dataOffset >= 0) || !(expected > 0) || dataOffset + expected > available) {
    throw new Error(`${what} is truncated: the header promises ${expected} bytes at ${dataOffset}, the file holds ${available}`);
  }
}

/** PixelSpacing "row\col" in mm; multiframe keeps it inside the functional groups. */
export function xySpacingOf(ds: dicomParser.DataSet): number | null {
  const direct = ds.string(XTAG.pixelSpacing);
  if (direct) {
    const v = Number(direct.split('\\')[0]);
    if (v > 0) return v;
  }
  for (const fgTag of [XTAG.sharedFG, TAG.perFrameFG]) {
    const fg = ds.elements[fgTag]?.items?.[0]?.dataSet;
    const pm = fg?.elements[XTAG.pixelMeasures]?.items?.[0]?.dataSet;
    const s = pm?.string(XTAG.pixelSpacing);
    if (s) {
      const v = Number(s.split('\\')[0]);
      if (v > 0) return v;
    }
  }
  return null;
}

export function zSpacingOf(ds: dicomParser.DataSet, xy: number): number {
  // explicit spacing tags first (top level, then shared functional group)...
  for (const src of [
    () => ds.string(XTAG.spacingBetween),
    () =>
      ds.elements[XTAG.sharedFG]?.items?.[0]?.dataSet?.elements[XTAG.pixelMeasures]?.items?.[0]?.dataSet?.string(
        XTAG.spacingBetween,
      ),
    () => ds.string(XTAG.sliceThickness),
  ]) {
    const v = Number(src() ?? NaN);
    if (v > 0) return v;
  }
  // ...then the per-frame plane positions; CBCT is isotropic as the last resort
  const pf = ds.elements[TAG.perFrameFG];
  if (pf?.items && pf.items.length >= 2) {
    const posOf = (i: number) => pf.items![i].dataSet?.elements[TAG.planePosSeq]?.items?.[0]?.dataSet ?? null;
    const a = posOf(0);
    const b = posOf(1);
    if (a && b) {
      const d = Math.abs(ippZ(b) - ippZ(a));
      if (d > 0) return d;
    }
  }
  return xy;
}

const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** the display label: the last two segments of a '/'-separated relative path, or the root's name */
export function labelOf(rootLabel: string, rel: string, useDir = false): string {
  const p = useDir ? dirname(rel) : rel;
  const base = p === '' || p === '.' ? rootLabel : p.split('/').slice(-2).join('/');
  return base.replace(/\.dcm$/i, '');
}
