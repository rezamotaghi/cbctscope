// SERVER-ONLY. The 'open' source: the user-chosen local folder or file the viewer reads.
// This is the heart of the privacy stance: scans are read IN PLACE on this machine and are
// never copied, uploaded, or written anywhere. File paths never leave the server (the browser
// sees only display labels + technical geometry), and serving is contained to exactly the
// scanned tree.
//
// Three export shapes are recognized, all normalized to the SAME browser contract
// (Int16 HU voxels, x-fastest / y / z-ascending + geometry JSON), so the whole viewer works on
// an opened volume with zero client changes:
//   - single multiframe file      one Enhanced-CT .dcm holding the whole volume
//   - slice-per-file series       a folder of classic-CT axials (grouped by SeriesInstanceUID)
//   - DICOMDIR trees              scanned by walking the files themselves (an export's index can
//                                 be an extensionless file and its images extensionless too, so
//                                 detection is by the DICM magic bytes, never by extension)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import dicomParser from 'dicom-parser';
import { DEMO_MODE, SOURCE_STORE } from './config';
import {
  TAG,
  ippZ,
  ippVec,
  u16Copy,
  robustVoi,
  type AssembledVolume,
  type CbctListEntry,
  type CbctVolumeMeta,
} from './dicom';

/** Where the opened source persists across dev-server restarts. */
const STORE_PATH = SOURCE_STORE;

const MAX_WALK_FILES = 8000;
const MAX_WALK_DEPTH = 8;
const HEAD_BYTES = 4 * 1024 * 1024; // first read: covers virtually every header
const HEAD_RETRY_BYTES = 32 * 1024 * 1024; // retry: giant per-frame functional groups
const MIN_SLICES = 30; // fewer single-frame files than this is not a CBCT series
const MIN_MF_FRAMES = 16;
const MAX_VOLUME_BYTES = 1.5e9; // runaway guard (≈ 900² × 900 slices)

// extra tags the scanner needs beyond the shared TAG set
const XTAG = {
  tsUid: 'x00020010',
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
} as const;

const UNCOMPRESSED_TS = new Set(['1.2.840.10008.1.2', '1.2.840.10008.1.2.1']);

export interface LocalCbctVolume {
  id: string; // local_<12 hex> — stable per (root, first file) so annotation sidecars survive reopen
  kind: 'mf' | 'slices';
  /** file paths RELATIVE to root ('mf' → exactly one) */
  files: string[];
  dims: [number, number, number];
  spacing: [number, number, number];
  fov: [number, number];
  label: string;
  year: string;
  signed: boolean;
}

export interface LocalCbctSource {
  root: string;
  label: string;
  volumes: LocalCbctVolume[];
}

let cached: LocalCbctSource | null | undefined; // undefined = not loaded yet

export function getLocalSource(): LocalCbctSource | null {
  if (cached !== undefined) return cached;
  if (DEMO_MODE) {
    cached = null;
    return cached;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) as LocalCbctSource;
    cached =
      typeof raw?.root === 'string' && Array.isArray(raw.volumes) && fs.statSync(raw.root).isDirectory()
        ? raw
        : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function clearLocalSource(): void {
  cached = null;
  try {
    fs.rmSync(STORE_PATH, { force: true });
  } catch {
    /* already gone */
  }
}

export const isLocalCbctId = (id: string) => id.startsWith('local_');

// ---------------------------------------------------------------------------
// Scan

function isDicomFile(full: string): boolean {
  // DICM magic at offset 128 — extension-blind (DICOMDIR image trees are extensionless).
  let fd: number | null = null;
  try {
    fd = fs.openSync(full, 'r');
    const head = Buffer.alloc(132);
    const n = fs.readSync(fd, head, 0, 132, 0);
    return n === 132 && head.toString('latin1', 128, 132) === 'DICM';
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Header-only parse of a file's first chunk; retries with a bigger read once. */
function parseHead(full: string): dicomParser.DataSet | null {
  const size = fs.statSync(full).size;
  for (const cap of [HEAD_BYTES, HEAD_RETRY_BYTES]) {
    const len = Math.min(size, cap);
    let fd: number | null = null;
    try {
      fd = fs.openSync(full, 'r');
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, 0);
      return dicomParser.parseDicom(buf, { untilTag: TAG.pixelData });
    } catch (err) {
      // dicom-parser attaches the partial parse to the thrown object in some failure modes
      const partial = (err as { dataSet?: dicomParser.DataSet })?.dataSet;
      if (partial?.elements && Object.keys(partial.elements).length > 8) return partial;
      if (len >= size) return null; // whole file read and still unparseable
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }
  return null;
}

/** PixelSpacing "row\col" → mm; multiframe keeps it inside the functional groups. */
function xySpacingOf(ds: dicomParser.DataSet): number | null {
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

function zSpacingOf(ds: dicomParser.DataSet, xy: number): number {
  // explicit spacing tags first (top level, then shared functional group)…
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
  // …then the per-frame plane positions; CBCT is isotropic as the last resort
  const pf = ds.elements[TAG.perFrameFG];
  if (pf?.items && pf.items.length >= 2) {
    const posOf = (i: number) =>
      pf.items![i].dataSet?.elements[TAG.planePosSeq]?.items?.[0]?.dataSet ?? null;
    const a = posOf(0);
    const b = posOf(1);
    if (a && b) {
      const d = Math.abs(ippZ(b) - ippZ(a));
      if (d > 0) return d;
    }
  }
  return xy;
}

function volumeId(root: string, firstRel: string): string {
  return `local_${crypto.createHash('md5').update(`${root}\0${firstRel}`).digest('hex').slice(0, 12)}`;
}

interface SliceRec {
  rel: string;
  z: number;
  rows: number;
  cols: number;
  xy: number | null;
  year: string;
}

interface ScanOut {
  volumes: LocalCbctVolume[];
  dicomFiles: number;
  skippedCompressed: number;
}

/** Walk a tree, classify every DICOM file, and group into openable volumes. */
function scanTree(root: string, only?: string): ScanOut {
  const volumes: LocalCbctVolume[] = [];
  const series = new Map<string, SliceRec[]>();
  let dicomFiles = 0;
  let skippedCompressed = 0;
  let seen = 0;

  const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (stack.length && seen < MAX_WALK_FILES) {
    const { dir, depth } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_WALK_DEPTH) stack.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!e.isFile() || seen >= MAX_WALK_FILES) continue;
      seen++;
      if (only && path.relative(root, full) !== only) continue;
      if (!isDicomFile(full)) continue;
      const ds = parseHead(full);
      if (!ds) continue;
      dicomFiles++;

      const ts = (ds.string(XTAG.tsUid) ?? '1.2.840.10008.1.2.1').trim();
      const rows = ds.uint16(TAG.rows) ?? 0;
      const cols = ds.uint16(TAG.cols) ?? 0;
      const bits = ds.uint16(XTAG.bitsAllocated) ?? 16;
      const frames = Number(ds.string(TAG.frames) ?? 1) || 1;
      if (rows < 64 || cols < 64 || bits !== 16) continue; // thumbnails / 8-bit secondaries
      if (!UNCOMPRESSED_TS.has(ts)) {
        if (frames >= MIN_MF_FRAMES || (ds.string(XTAG.modality) ?? 'CT') === 'CT') skippedCompressed++;
        continue; // the assembler reads raw pixels — compressed syntaxes are out of scope
      }
      const rel = path.relative(root, full);
      const year = (ds.string(XTAG.studyDate) ?? '').slice(0, 4);
      const signed = (ds.uint16(XTAG.pixelRep) ?? 0) === 1;

      if (frames >= MIN_MF_FRAMES) {
        const xy = xySpacingOf(ds) ?? 0.3;
        const zsp = zSpacingOf(ds, xy);
        const bytes = rows * cols * frames * 2;
        if (bytes > MAX_VOLUME_BYTES) continue;
        volumes.push({
          id: volumeId(root, rel),
          kind: 'mf',
          files: [rel],
          dims: [cols, rows, frames],
          spacing: [xy, xy, zsp],
          fov: [round1((cols * xy) / 10), round1((frames * zsp) / 10)],
          label: labelOf(root, rel),
          year,
          signed,
        });
        continue;
      }

      // single-frame: CBCT axials are CT; everything else (PX/DX/IO scouts…) is not a volume
      const modality = ds.string(XTAG.modality) ?? 'CT';
      if (modality !== 'CT') continue;
      const key = ds.string(XTAG.seriesUid) ?? path.dirname(rel);
      const list = series.get(key) ?? [];
      list.push({ rel, z: ippZ(ds), rows, cols, xy: xySpacingOf(ds), year });
      series.set(key, list);
    }
  }

  for (const recs of series.values()) {
    if (recs.length < MIN_SLICES) continue;
    // consistent matrix only (a series with mixed dims is a mixed export — take the majority)
    const dimKey = (r: SliceRec) => `${r.rows}x${r.cols}`;
    const counts = new Map<string, number>();
    for (const r of recs) counts.set(dimKey(r), (counts.get(dimKey(r)) ?? 0) + 1);
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const use = recs.filter((r) => dimKey(r) === majority);
    if (use.length < MIN_SLICES) continue;
    use.sort((a, b) => a.z - b.z);
    const xy = use.find((r) => r.xy)?.xy ?? 0.3;
    // median z step — robust to a duplicated or missing slice
    const deltas = use.slice(1).map((r, i) => Math.abs(r.z - use[i].z)).sort((a, b) => a - b);
    const zsp = deltas[Math.floor(deltas.length / 2)] || xy;
    const [rows, cols] = majority.split('x').map(Number);
    const bytes = rows * cols * use.length * 2;
    if (bytes > MAX_VOLUME_BYTES) continue;
    volumes.push({
      id: volumeId(root, use[0].rel),
      kind: 'slices',
      files: use.map((r) => r.rel),
      dims: [cols, rows, use.length],
      spacing: [xy, xy, zsp],
      fov: [round1((cols * xy) / 10), round1((use.length * zsp) / 10)],
      label: labelOf(root, use[0].rel, true),
      year: use[0].year,
      signed: false, // classic-CT CBCT exports are unsigned; the assembler re-checks per file
    });
  }

  volumes.sort((a, b) => a.label.localeCompare(b.label));
  return { volumes, dicomFiles, skippedCompressed };
}

function labelOf(root: string, rel: string, useDir = false): string {
  const p = useDir ? path.dirname(rel) : rel;
  const base = p === '.' || p === '' ? path.basename(root) : p.split(path.sep).slice(-2).join('/');
  return base.replace(/\.dcm$/i, '');
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Point the CBCT viewer at a folder, a DICOMDIR (file or its folder), a single multiframe
 * volume file, or one slice of a series (opens the whole series around it).
 */
export function setLocalSource(
  inputPath: string,
): { ok: true; label: string; count: number } | { ok: false; error: string } {
  let p = inputPath.trim();
  if (!p) return { ok: false, error: 'empty path' };
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  p = path.resolve(p);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    return { ok: false, error: 'path does not exist' };
  }

  let root: string;
  let only: string | undefined;
  if (stat.isDirectory()) {
    root = p;
  } else if (stat.isFile()) {
    root = path.dirname(p);
    if (path.basename(p).toUpperCase() !== 'DICOMDIR') {
      if (!isDicomFile(p)) return { ok: false, error: 'not a DICOM file (or a compressed/foreign format)' };
      const ds = parseHead(p);
      const frames = Number(ds?.string(TAG.frames) ?? 1) || 1;
      // a picked multiframe = open just that volume; a picked slice = open its whole series
      if (frames >= MIN_MF_FRAMES) only = path.relative(root, p);
    }
  } else {
    return { ok: false, error: 'not a folder or file' };
  }

  let scan: ScanOut;
  try {
    scan = scanTree(root, only);
  } catch (err) {
    console.error('[localSource] scan failed:', (err as { code?: string })?.code ?? 'unreadable'); // server-side only — never echo fs paths
    return { ok: false, error: 'scan failed' };
  }
  if (!scan.volumes.length) {
    return {
      ok: false,
      error:
        scan.skippedCompressed > 0
          ? `found ${scan.skippedCompressed} compressed DICOM file(s) — only uncompressed exports are supported`
          : scan.dicomFiles > 0
            ? 'DICOM files found, but no CBCT volume (multiframe or ≥30-slice CT series) among them'
            : 'no DICOM files found there',
    };
  }

  const source: LocalCbctSource = { root, label: path.basename(only ? p : root), volumes: scan.volumes };
  if (!DEMO_MODE) {
    try {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
      fs.writeFileSync(STORE_PATH, JSON.stringify(source));
    } catch {
      /* persistence is best-effort — the in-memory source still works this run */
    }
  }
  cached = source;
  lru.clear(); // ids may collide across re-points of the same tree — drop stale voxels
  return { ok: true, label: source.label, count: source.volumes.length };
}

// ---------------------------------------------------------------------------
// List + assembly (the shared browser contract)

export type LocalListEntry = CbctListEntry & { label: string };

export function listLocalVolumes(): LocalListEntry[] {
  const s = getLocalSource();
  if (!s) return [];
  // a moved/unplugged tree must not 500 the catalog
  return s.volumes
    .filter((v) => fs.existsSync(path.join(s.root, v.files[0])))
    .map((v) => ({
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
}

/** Int16 pixel copy honoring PixelRepresentation (raw CBCT exports are usually unsigned). */
function pxToInt16(buf: Buffer, offset: number, byteLen: number, signed: boolean): Int16Array | Uint16Array {
  if (!signed) return u16Copy(buf, offset, byteLen);
  const copy = Buffer.alloc(byteLen);
  buf.copy(copy, 0, offset, offset + byteLen);
  return new Int16Array(copy.buffer, 0, byteLen / 2);
}

function metaOf(v: LocalCbctVolume, dims: [number, number, number], origin: [number, number, number], voi: { center: number; width: number }, bytes: number): CbctVolumeMeta {
  return {
    anon: v.id,
    kind: v.kind,
    dims,
    spacing: v.spacing,
    fov: v.fov,
    region: v.label,
    year: v.year,
    pair: null,
    origin,
    defaultVoi: voi,
    bytes,
  };
}

function assembleLocalMultiframe(src: LocalCbctSource, v: LocalCbctVolume): AssembledVolume {
  const buf = fs.readFileSync(path.join(src.root, v.files[0]));
  const ds = dicomParser.parseDicom(buf);
  const rows = ds.uint16(TAG.rows) ?? v.dims[1];
  const cols = ds.uint16(TAG.cols) ?? v.dims[0];
  const frames = Number(ds.string(TAG.frames) ?? v.dims[2]) || v.dims[2];
  const slope = Number(ds.string(TAG.slope) ?? 1) || 1;
  const intercept = Number(ds.string(TAG.intercept) ?? 0);
  const signed = (ds.uint16(XTAG.pixelRep) ?? 0) === 1;

  // per-frame plane positions: first, second, last → z direction + origin (the browser
  // always receives z-ASCENDING voxels)
  const pf = ds.elements[TAG.perFrameFG];
  let z0 = 0;
  let z1 = v.spacing[2];
  let zLast = v.spacing[2] * (frames - 1);
  let origin: [number, number, number] = [0, 0, 0];
  if (pf?.items?.length) {
    const posOf = (i: number) => pf.items![i].dataSet?.elements[TAG.planePosSeq]?.items?.[0]?.dataSet ?? null;
    const p0 = posOf(0);
    const p1 = posOf(Math.min(1, pf.items.length - 1));
    const pL = posOf(pf.items.length - 1);
    if (p0 && p1 && pL) {
      origin = ippVec(p0);
      z0 = ippZ(p0);
      z1 = ippZ(p1);
      zLast = ippZ(pL);
    }
  }
  const ascending = z1 >= z0;
  origin = [origin[0], origin[1], Math.min(z0, zLast)];

  const pixelEl = ds.elements[TAG.pixelData];
  if (!pixelEl) throw new Error('no pixel data');
  const frameLen = rows * cols;
  const out = new Int16Array(frameLen * frames);
  for (let f = 0; f < frames; f++) {
    const srcF = ascending ? f : frames - 1 - f;
    const px = pxToInt16(buf, pixelEl.dataOffset + srcF * frameLen * 2, frameLen * 2, signed);
    const base = f * frameLen;
    for (let i = 0; i < frameLen; i++) out[base + i] = px[i] * slope + intercept;
  }
  const mid = out.subarray(Math.floor(frames / 2) * frameLen, (Math.floor(frames / 2) + 1) * frameLen);
  return {
    meta: metaOf(v, [cols, rows, frames], origin, robustVoi(mid as Int16Array), out.byteLength),
    data: Buffer.from(out.buffer, 0, out.byteLength),
  };
}

function assembleLocalSlices(src: LocalCbctSource, v: LocalCbctVolume): AssembledVolume {
  const parsed = v.files.map((rel) => {
    const buf = fs.readFileSync(path.join(src.root, rel));
    const ds = dicomParser.parseDicom(buf);
    return { buf, ds, z: ippZ(ds) };
  });
  parsed.sort((a, b) => a.z - b.z); // z-ascending
  const first = parsed[0].ds;
  const rows = first.uint16(TAG.rows) ?? v.dims[1];
  const cols = first.uint16(TAG.cols) ?? v.dims[0];
  const slope = Number(first.string(TAG.slope) ?? 1) || 1;
  const intercept = Number(first.string(TAG.intercept) ?? 0);
  const signed = (first.uint16(XTAG.pixelRep) ?? 0) === 1;
  const frameLen = rows * cols;
  const out = new Int16Array(frameLen * parsed.length);
  parsed.forEach(({ buf, ds }, f) => {
    const el = ds.elements[TAG.pixelData];
    if (!el) throw new Error(`slice ${f}: no pixel data`);
    const px = pxToInt16(buf, el.dataOffset, frameLen * 2, signed);
    const base = f * frameLen;
    for (let i = 0; i < frameLen; i++) out[base + i] = px[i] * slope + intercept;
  });
  const origin = ippVec(first);
  const mid = out.subarray(
    Math.floor(parsed.length / 2) * frameLen,
    (Math.floor(parsed.length / 2) + 1) * frameLen,
  );
  return {
    meta: metaOf(v, [cols, rows, parsed.length], origin, robustVoi(mid as Int16Array), out.byteLength),
    data: Buffer.from(out.buffer, 0, out.byteLength),
  };
}

// raw opened volumes can be several hundred MB — keep exactly one resident
const lru = new Map<string, AssembledVolume>();
const LRU_MAX = 1;

export function getAssembledLocalVolume(id: string): AssembledVolume {
  const hit = lru.get(id);
  if (hit) return hit;
  const src = getLocalSource();
  const v = src?.volumes.find((x) => x.id === id);
  if (!src || !v) throw new Error('unknown local volume');
  const vol = v.kind === 'mf' ? assembleLocalMultiframe(src, v) : assembleLocalSlices(src, v);
  lru.set(id, vol);
  while (lru.size > LRU_MAX) lru.delete(lru.keys().next().value as string);
  return vol;
}
