// BROWSER. The scanner of the opened source: the port of lib/server/localSource.ts's tree walk
// for the files the clinician hands the page (a folder from <input webkitdirectory>, one file,
// or a drop walked into File objects). Nothing is uploaded or copied: only header bytes are
// read here; pixels are read later, in the assembly worker.
//
// The same four export shapes are recognized, with the same limits and the same rules:
//   - single multiframe file      one Enhanced-CT file holding the whole volume
//   - slice-per-file series       classic-CT axials grouped by SeriesInstanceUID, sorted by z
//   - DICOMDIR trees              walked by the files themselves; detection is by the DICM
//                                 magic bytes at offset 128, never by extension
//   - 2D radiographs ('xray')     single-frame PX/DX/CR/IO files, one-slice volumes
//
// Paths: each File's webkitRelativePath ("Folder/sub/IM0001") gives the tree; a drop walker
// that builds File objects itself defines that property on each instance. A File with an
// empty webkitRelativePath is a loose file and its name is its path.
import dicomParser from 'dicom-parser';
import { TAG, ippZ } from '../shared/dicom';

export const MAX_WALK_FILES = 8000;
export const MAX_WALK_DEPTH = 8;
export const HEAD_BYTES = 4 * 1024 * 1024; // first read: covers virtually every header
export const HEAD_RETRY_BYTES = 32 * 1024 * 1024; // retry: giant per-frame functional groups
export const MIN_SLICES = 30; // fewer single-frame files than this is not a CBCT series
export const MIN_MF_FRAMES = 16;
export const MAX_VOLUME_BYTES = 1.5e9; // runaway guard (about 900^2 x 900 slices)

// extra tags the scanner needs beyond the shared TAG set (as in localSource.ts)
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

const UNCOMPRESSED_TS = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1']);
const RADIOGRAPH_MODALITIES = new Set(['PX', 'DX', 'CR', 'IO']);

/** an openable volume found by the scan; `files` are the File objects, never paths */
export interface BrowserVolume {
  id: string; // local_<12 hex>, from the series identity, so sidecars survive a reopen
  kind: 'mf' | 'slices' | 'xray';
  /** 'mf'/'xray': exactly one; 'slices': z-ascending */
  files: File[];
  dims: [number, number, number];
  spacing: [number, number, number];
  fov: [number, number];
  label: string;
  year: string;
  signed: boolean;
  /** 'xray' only: PhotometricInterpretation was MONOCHROME1 (flipped to MONOCHROME2 at assembly) */
  mono1?: boolean;
}

export type ScanResult =
  | { ok: true; label: string; volumes: BrowserVolume[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// path helpers (forward slashes: webkitRelativePath is always '/'-separated)

const relPathOf = (f: File) => (f.webkitRelativePath || f.name).replace(/^\/+/, '');
const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

function labelOf(rootLabel: string, rel: string, useDir = false): string {
  const p = useDir ? dirname(rel) : rel;
  const base = p === '' ? rootLabel : p.split('/').slice(-2).join('/');
  return base.replace(/\.dcm$/i, '');
}

const round1 = (v: number) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// header reads

export async function isDicomFile(file: File): Promise<boolean> {
  if (file.size < 132) return false;
  try {
    const head = new Uint8Array(await file.slice(0, 132).arrayBuffer());
    return head[128] === 0x44 && head[129] === 0x49 && head[130] === 0x43 && head[131] === 0x4d; // 'DICM'
  } catch {
    return false;
  }
}

/** Header-only parse of a file's first chunk; retries with a bigger read once. */
export async function parseHead(file: File): Promise<dicomParser.DataSet | null> {
  const size = file.size;
  for (const cap of [HEAD_BYTES, HEAD_RETRY_BYTES]) {
    const len = Math.min(size, cap);
    try {
      const buf = new Uint8Array(await file.slice(0, len).arrayBuffer());
      return dicomParser.parseDicom(buf, { untilTag: TAG.pixelData });
    } catch (err) {
      // dicom-parser attaches the partial parse to the thrown object in some failure modes
      const partial = (err as { dataSet?: dicomParser.DataSet })?.dataSet;
      if (partial?.elements && Object.keys(partial.elements).length > 8) return partial;
      if (len >= size) return null; // whole file read and still unparseable
    }
  }
  return null;
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

/** local_<12 hex>: SHA-256 of the series identity (SeriesInstanceUID, or the single file's
 * SOP Instance UID) plus the file count. Path-free, so the same export opened from another
 * folder or another machine keeps its id and its sidecar. */
export async function volumeId(identity: string, fileCount: number): Promise<string> {
  const bytes = new TextEncoder().encode(`${identity}\0${fileCount}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (let i = 0; i < 6; i++) hex += digest[i].toString(16).padStart(2, '0');
  return `local_${hex}`;
}

// ---------------------------------------------------------------------------
// scan

interface SliceRec {
  file: File;
  rel: string;
  z: number;
  rows: number;
  cols: number;
  xy: number | null;
  year: string;
}

/** Classify every DICOM file among `files` and group them into openable volumes. */
export async function scanFiles(files: File[], label?: string): Promise<ScanResult> {
  if (!files.length) return { ok: false, error: 'no files' };

  // the tree's root: the shared first path segment of a folder pick, else none (loose files)
  const rels = files.map(relPathOf);
  const first = rels[0].split('/')[0];
  const rooted = rels.every((r) => r.includes('/') && r.split('/')[0] === first);
  const rootName = rooted ? first : '';
  const sourceLabel = label || rootName || (files.length === 1 ? files[0].name : 'Opened files');

  const volumes: BrowserVolume[] = [];
  const series = new Map<string, SliceRec[]>();
  let dicomFiles = 0;
  let skippedCompressed = 0;
  let seen = 0;

  for (let n = 0; n < files.length && seen < MAX_WALK_FILES; n++) {
    const file = files[n];
    const rel = rooted ? rels[n].slice(first.length + 1) : rels[n];
    const segs = rel.split('/');
    if (segs.some((s) => s.startsWith('.'))) continue; // hidden files and folders, as the walk skips them
    if (segs.length - 1 > MAX_WALK_DEPTH) continue;
    seen++;
    if (!(await isDicomFile(file))) continue;
    const ds = await parseHead(file);
    if (!ds) continue;
    dicomFiles++;

    const ts = (ds.string(XTAG.tsUid) ?? '1.2.840.10008.1.2.1').trim();
    const rows = ds.uint16(TAG.rows) ?? 0;
    const cols = ds.uint16(TAG.cols) ?? 0;
    const bits = ds.uint16(XTAG.bitsAllocated) ?? 16;
    const frames = Number(ds.string(TAG.frames) ?? 1) || 1;
    if (rows < 64 || cols < 64 || bits !== 16) continue; // thumbnails / 8-bit secondaries
    if (!UNCOMPRESSED_TS.has(ts)) {
      const m = ds.string(XTAG.modality) ?? 'CT';
      if (frames >= MIN_MF_FRAMES || m === 'CT' || RADIOGRAPH_MODALITIES.has(m)) skippedCompressed++;
      continue; // the assembler reads raw pixels: compressed syntaxes are out of scope
    }
    const year = (ds.string(XTAG.studyDate) ?? '').slice(0, 4);
    const signed = (ds.uint16(XTAG.pixelRep) ?? 0) === 1;
    const sopUid = (ds.string(XTAG.sopInstanceUid) ?? '').trim() || rel;

    if (frames >= MIN_MF_FRAMES) {
      const xy = xySpacingOf(ds) ?? 0.3;
      const zsp = zSpacingOf(ds, xy);
      const bytes = rows * cols * frames * 2;
      if (bytes > MAX_VOLUME_BYTES) continue;
      volumes.push({
        id: await volumeId(sopUid, 1),
        kind: 'mf',
        files: [file],
        dims: [cols, rows, frames],
        spacing: [xy, xy, zsp],
        fov: [round1((cols * xy) / 10), round1((frames * zsp) / 10)],
        label: labelOf(sourceLabel, rel),
        year,
        signed,
      });
      continue;
    }

    // single-frame: CBCT axials are CT and group into series below; PX/DX/CR/IO are
    // openable 2D radiographs on the same contract (a one-slice volume); the rest is noise
    const modality = ds.string(XTAG.modality) ?? 'CT';
    if (RADIOGRAPH_MODALITIES.has(modality)) {
      // ImagerPixelSpacing is the honest tag for projection radiographs; nominal 0.1 mm otherwise
      const spRaw =
        Number((ds.string(XTAG.imagerPixelSpacing) ?? '').split('\\')[0]) || xySpacingOf(ds) || 0.1;
      const bytes = rows * cols * 2;
      if (bytes > MAX_VOLUME_BYTES) continue;
      volumes.push({
        id: await volumeId(sopUid, 1),
        kind: 'xray',
        files: [file],
        dims: [cols, rows, 1],
        spacing: [spRaw, spRaw, 1],
        fov: [round1((cols * spRaw) / 10), round1((rows * spRaw) / 10)],
        label: labelOf(sourceLabel, rel),
        year,
        signed,
        mono1: (ds.string(XTAG.photometric) ?? '').trim().toUpperCase() === 'MONOCHROME1',
      });
      continue;
    }
    if (modality !== 'CT') continue;
    const key = (ds.string(XTAG.seriesUid) ?? '').trim() || `dir:${dirname(rel)}`;
    const list = series.get(key) ?? [];
    list.push({ file, rel, z: ippZ(ds), rows, cols, xy: xySpacingOf(ds), year });
    series.set(key, list);
  }

  for (const [key, recs] of series) {
    if (recs.length < MIN_SLICES) continue;
    // consistent matrix only (a series with mixed dims is a mixed export: take the majority)
    const dimKey = (r: SliceRec) => `${r.rows}x${r.cols}`;
    const counts = new Map<string, number>();
    for (const r of recs) counts.set(dimKey(r), (counts.get(dimKey(r)) ?? 0) + 1);
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const use = recs.filter((r) => dimKey(r) === majority);
    if (use.length < MIN_SLICES) continue;
    use.sort((a, b) => a.z - b.z);
    const xy = use.find((r) => r.xy)?.xy ?? 0.3;
    // median z step: robust to a duplicated or missing slice
    const deltas = use
      .slice(1)
      .map((r, i) => Math.abs(r.z - use[i].z))
      .sort((a, b) => a - b);
    const zsp = deltas[Math.floor(deltas.length / 2)] || xy;
    const [rows, cols] = majority.split('x').map(Number);
    const bytes = rows * cols * use.length * 2;
    if (bytes > MAX_VOLUME_BYTES) continue;
    volumes.push({
      id: await volumeId(key, use.length),
      kind: 'slices',
      files: use.map((r) => r.file),
      dims: [cols, rows, use.length],
      spacing: [xy, xy, zsp],
      fov: [round1((cols * xy) / 10), round1((use.length * zsp) / 10)],
      label: labelOf(sourceLabel, use[0].rel, true),
      year: use[0].year,
      signed: false, // classic-CT CBCT exports are unsigned; the assembler re-checks per file
    });
  }

  if (!volumes.length) {
    return {
      ok: false,
      error:
        skippedCompressed > 0
          ? `found ${skippedCompressed} compressed DICOM file(s): only uncompressed exports are supported`
          : dicomFiles > 0
            ? 'DICOM files found, but no CBCT volume (multiframe or ≥30-slice CT series) and no 2D radiograph (PX/DX/CR/IO) among them'
            : 'no DICOM files found there',
    };
  }
  volumes.sort((a, b) => a.label.localeCompare(b.label));
  return { ok: true, label: sourceLabel, volumes };
}
