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
import {
  HEAD_BYTES,
  HEAD_RETRY_BYTES,
  labelOf,
  MAX_VOLUME_BYTES,
  MAX_WALK_DEPTH,
  MAX_WALK_FILES,
  MIN_MF_FRAMES,
  MIN_SLICES,
  positiveIntTag,
  RADIOGRAPH_MODALITIES,
  round1,
  UNCOMPRESSED_TS,
  XTAG,
  xySpacingOf,
  zSpacingOf,
} from '../shared/dicomScan';
import { sha256Hex } from '../shared/sha256';
import { createThrottle } from './progress';

// the scan rules live in lib/shared/dicomScan.ts, shared with lib/server/localSource.ts
export {
  HEAD_BYTES,
  HEAD_RETRY_BYTES,
  MAX_VOLUME_BYTES,
  MAX_WALK_DEPTH,
  MAX_WALK_FILES,
  MIN_MF_FRAMES,
  MIN_SLICES,
  XTAG,
  xySpacingOf,
  zSpacingOf,
};

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
  | { ok: false; error: string; scanned?: number; reasons?: string[]; headline?: string };

/** what a scan that opened nothing saw, as counts: the input of the refusal's first line */
export interface RefusalCounts {
  total: number;
  noMagic: number;
  compressed: number;
  /** files of another modality, and those modalities */
  otherModality: number;
  modalities: string[];
  shortSeries: number;
  oversize: number;
  /** files refused for any reason but their modality (unreadable, thumbnails, bad geometry) */
  otherwiseRefused: number;
  capped: boolean;
}

const EXPORT_AGAIN = 'Export from your CBCT software as DICOM, with compression off.';

/**
 * The refusal's first line: plain words and what to do, before the technical reason. The most
 * telling case wins; a folder of another kind of scanner gets no compression advice, because
 * compression is not its problem.
 */
export function refusalHeadline(c: RefusalCounts): string {
  if (c.capped) return `This folder holds more than ${fmtCount(MAX_WALK_FILES)} files. Open the export folder itself.`;
  // every refused file was refused for its modality alone
  if (c.otherModality > 0 && c.noMagic + c.compressed + c.shortSeries + c.oversize + c.otherwiseRefused === 0) {
    return `These files are from another kind of scanner (${c.modalities.join(', ')}), not a CBCT export.`;
  }
  if (c.total > 0 && c.noMagic === c.total) return `These files are not DICOM images. ${EXPORT_AGAIN}`;
  if (c.compressed > 0) return `These DICOM files are compressed. ${EXPORT_AGAIN}`;
  if (c.shortSeries > 0) return `These files hold no complete CBCT volume. Export the whole volume from your CBCT software as DICOM, with compression off.`;
  if (c.oversize > 0) return 'This volume is larger than the 1.5 GB the viewer opens. Export a smaller field of view or a coarser voxel size.';
  return `No CBCT volume could be read from these files. ${EXPORT_AGAIN}`;
}

// ---------------------------------------------------------------------------
// path helpers (forward slashes: webkitRelativePath is always '/'-separated)

const relPathOf = (f: File) => (f.webkitRelativePath || f.name).replace(/^\/+/, '');
const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

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

/**
 * local_<12 hex>: SHA-256 (lib/shared/sha256.ts, pure, so no crypto.subtle is needed) of the
 * series identity plus the file count. With a UID (SeriesInstanceUID, or the single file's
 * SOP Instance UID) that is all, path-free, so the same export opened from another folder or
 * another machine keeps its id and its sidecar. Without one, `extra` carries what tells two
 * exports apart: the total byte size and the sorted first and last file names.
 */
export async function volumeId(identity: string, fileCount: number, extra?: string): Promise<string> {
  return `local_${sha256Hex(`${identity}\0${fileCount}${extra === undefined ? '' : `\0${extra}`}`, 6)}`;
}

/** the disambiguator of a UID-less export: total bytes, then the sorted first and last names
 * (a slice series adds its first and last z position, so two exports named alike still differ) */
export function uidlessExtra(files: File[]): string {
  const bytes = files.reduce((a, f) => a + f.size, 0);
  const names = files.map((f) => f.name).sort();
  return `${bytes}\0${names[0] ?? ''}\0${names[names.length - 1] ?? ''}`;
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

/** header-scan progress: files read so far of the files the scan will read */
export type ScanProgress = (done: number, total: number) => void;

/** files whose magic bytes are read together (one Promise.all), then classified in order */
export const SCAN_BATCH = 64;
/** header parses in flight at once: each reads up to HEAD_BYTES */
export const PARSE_CONCURRENCY = 8;
/** at most one progress report per this many ms */
export const SCAN_REPORT_MS = 50;

const fmtCount = (n: number) => n.toLocaleString('en-US');
const filesN = (n: number) => `${fmtCount(n)} ${n === 1 ? 'file' : 'files'}`;

/**
 * Classify every DICOM file among `files` and group them into openable volumes. Magic bytes
 * are read SCAN_BATCH files at a time and headers PARSE_CONCURRENCY at a time; classification
 * stays in file order, so the result does not depend on read timing.
 */
export async function scanFiles(
  files: File[],
  label?: string,
  onProgress?: ScanProgress,
  now: () => number = () => performance.now(),
): Promise<ScanResult> {
  if (!files.length) return { ok: false, error: 'no files' };

  // the tree's root: the shared first path segment of a folder pick, else none (loose files)
  const rels = files.map(relPathOf);
  const first = rels[0].split('/')[0];
  const rooted = rels.every((r) => r.includes('/') && r.split('/')[0] === first);
  const rootName = rooted ? first : '';
  const sourceLabel = label || rootName || (files.length === 1 ? files[0].name : 'Opened files');

  // the walk's filters first (hidden, too deep, the file cap), so the total is known up front
  const todo: { file: File; rel: string }[] = [];
  let skippedHidden = 0;
  let n = 0;
  for (; n < files.length && todo.length < MAX_WALK_FILES; n++) {
    const rel = rooted ? rels[n].slice(first.length + 1) : rels[n];
    const segs = rel.split('/');
    // hidden files and folders, and anything too deep, as the walk skips them
    if (segs.some((s) => s.startsWith('.')) || segs.length - 1 > MAX_WALK_DEPTH) {
      skippedHidden++;
      continue;
    }
    todo.push({ file: files[n], rel });
  }
  const capped = n < files.length;
  const total = todo.length;

  const volumes: BrowserVolume[] = [];
  const series = new Map<string, SliceRec[]>();
  const why = { noMagic: 0, unreadable: 0, small: 0, compressed: 0, oversize: 0, badGeometry: 0, duplicate: 0 };
  /** SOP Instance UID plus size of every file kept: an exact duplicate inside one export is skipped */
  const seenFiles = new Set<string>();
  const otherModality = new Map<string, number>();

  const throttle = createThrottle(SCAN_REPORT_MS);
  let done = 0;
  const report = (force = false) => {
    if (onProgress && throttle(now(), force)) onProgress(done, total);
  };
  report(true);

  for (let b = 0; b < total; b += SCAN_BATCH) {
    const batch = todo.slice(b, b + SCAN_BATCH);
    const magic = await Promise.all(batch.map((t) => isDicomFile(t.file)));
    done += magic.filter((m) => !m).length;
    report();
    const heads: (dicomParser.DataSet | null)[] = batch.map(() => null);
    const hits = batch.map((_, i) => i).filter((i) => magic[i]);
    for (let h = 0; h < hits.length; h += PARSE_CONCURRENCY) {
      await Promise.all(
        hits.slice(h, h + PARSE_CONCURRENCY).map(async (i) => {
          heads[i] = await parseHead(batch[i].file);
          done++;
          report();
        }),
      );
    }

    for (let i = 0; i < batch.length; i++) {
      const { file, rel } = batch[i];
      if (!magic[i]) {
        why.noMagic++;
        continue;
      }
      const ds = heads[i];
      if (!ds) {
        why.unreadable++;
        continue;
      }

      const ts = (ds.string(XTAG.tsUid) ?? '1.2.840.10008.1.2.1').trim();
      const rows = ds.uint16(TAG.rows) ?? 0;
      const cols = ds.uint16(TAG.cols) ?? 0;
      const bits = ds.uint16(XTAG.bitsAllocated) ?? 16;
      const frames = positiveIntTag(ds.string(TAG.frames));
      if (frames === null) {
        why.badGeometry++; // NumberOfFrames "16.5", "0", "-3": refused, never rounded
        continue;
      }
      if (rows < 64 || cols < 64 || bits !== 16) {
        why.small++; // thumbnails / 8-bit secondaries
        continue;
      }
      if (!UNCOMPRESSED_TS.has(ts)) {
        const m = ds.string(XTAG.modality) ?? 'CT';
        if (frames >= MIN_MF_FRAMES || m === 'CT' || RADIOGRAPH_MODALITIES.has(m)) why.compressed++;
        continue; // the assembler reads raw pixels: compressed syntaxes are out of scope
      }
      const year = (ds.string(XTAG.studyDate) ?? '').slice(0, 4);
      const signed = (ds.uint16(XTAG.pixelRep) ?? 0) === 1;
      const uid = (ds.string(XTAG.sopInstanceUid) ?? '').trim();
      if (uid) {
        const dupKey = `${uid}\0${file.size}`;
        if (seenFiles.has(dupKey)) {
          why.duplicate++;
          continue;
        }
        seenFiles.add(dupKey);
      }

      if (frames >= MIN_MF_FRAMES) {
        const xy = xySpacingOf(ds) ?? 0.3;
        const zsp = zSpacingOf(ds, xy);
        const bytes = rows * cols * frames * 2;
        if (bytes > MAX_VOLUME_BYTES) {
          why.oversize++;
          continue;
        }
        volumes.push({
          id: uid ? await volumeId(uid, 1) : await volumeId(`file:${rel}`, 1, uidlessExtra([file])),
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
        if (bytes > MAX_VOLUME_BYTES) {
          why.oversize++;
          continue;
        }
        volumes.push({
          id: uid ? await volumeId(uid, 1) : await volumeId(`file:${rel}`, 1, uidlessExtra([file])),
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
      if (modality !== 'CT') {
        const m = modality.trim() || 'unknown';
        otherModality.set(m, (otherModality.get(m) ?? 0) + 1);
        continue;
      }
      const seriesUid = (ds.string(XTAG.seriesUid) ?? '').trim();
      const key = seriesUid ? `uid:${seriesUid}` : `dir:${dirname(rel)}`;
      const list = series.get(key) ?? [];
      list.push({ file, rel, z: ippZ(ds), rows, cols, xy: xySpacingOf(ds), year });
      series.set(key, list);
    }
  }
  report(true);

  const shortSeries: number[] = [];
  for (const [key, recs] of series) {
    if (recs.length < MIN_SLICES) {
      shortSeries.push(recs.length);
      continue;
    }
    // consistent matrix only (a series with mixed dims is a mixed export: take the majority)
    const dimKey = (r: SliceRec) => `${r.rows}x${r.cols}`;
    const counts = new Map<string, number>();
    for (const r of recs) counts.set(dimKey(r), (counts.get(dimKey(r)) ?? 0) + 1);
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const use = recs.filter((r) => dimKey(r) === majority);
    if (use.length < MIN_SLICES) {
      shortSeries.push(use.length);
      continue;
    }
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
    if (bytes > MAX_VOLUME_BYTES) {
      why.oversize++;
      continue;
    }
    const useFiles = use.map((r) => r.file);
    volumes.push({
      // a UID keeps the id stable across reopen; a UID-less series adds what tells exports apart
      id: key.startsWith('uid:')
        ? await volumeId(key.slice(4), use.length)
        : await volumeId(key, use.length, `${uidlessExtra(useFiles)}\0${use[0].z}\0${use[use.length - 1].z}`),
      kind: 'slices',
      files: useFiles,
      dims: [cols, rows, use.length],
      spacing: [xy, xy, zsp],
      fov: [round1((cols * xy) / 10), round1((use.length * zsp) / 10)],
      label: labelOf(sourceLabel, use[0].rel, true),
      year: use[0].year,
      signed: false, // classic-CT CBCT exports are unsigned; the assembler re-checks per file
    });
  }

  if (!volumes.length) {
    // what the scan saw, most actionable first: the reader can re-export or pick another folder
    const reasons: string[] = [];
    if (why.compressed) reasons.push(`compressed transfer syntax, only uncompressed exports open: ${filesN(why.compressed)}`);
    if (shortSeries.length) {
      const most = Math.max(...shortSeries);
      reasons.push(
        shortSeries.length === 1
          ? `too few slices for a CBCT series (at least ${MIN_SLICES}): one CT series of ${most}`
          : `too few slices for a CBCT series (at least ${MIN_SLICES}): ${shortSeries.length} CT series, the largest of ${most}`,
      );
    }
    if (why.noMagic) reasons.push(`no DICM magic bytes, not DICOM: ${filesN(why.noMagic)}`);
    if (why.unreadable) reasons.push(`DICOM header unreadable: ${filesN(why.unreadable)}`);
    if (why.badGeometry) reasons.push(`Rows, Columns or NumberOfFrames not a positive whole number: ${filesN(why.badGeometry)}`);
    if (why.duplicate) reasons.push(`exact duplicate files (same SOP Instance UID and size), skipped: ${filesN(why.duplicate)}`);
    if (why.small) reasons.push(`thumbnails or 8-bit images: ${filesN(why.small)}`);
    if (otherModality.size) {
      const count = [...otherModality.values()].reduce((a, c) => a + c, 0);
      reasons.push(`another modality (${[...otherModality.keys()].sort().join(', ')}): ${filesN(count)}`);
    }
    if (why.oversize) reasons.push(`over the 1.5 GB size guard: ${why.oversize} ${why.oversize === 1 ? 'volume' : 'volumes'}`);
    if (skippedHidden) reasons.push(`hidden, or deeper than ${MAX_WALK_DEPTH} folders, skipped: ${filesN(skippedHidden)}`);
    if (capped) reasons.push(`the scan stops at ${fmtCount(MAX_WALK_FILES)} files: open the export folder itself`);
    const otherCount = [...otherModality.values()].reduce((a, c) => a + c, 0);
    const headline = refusalHeadline({
      total,
      noMagic: why.noMagic,
      compressed: why.compressed,
      otherModality: otherCount,
      modalities: [...otherModality.keys()].sort(),
      shortSeries: shortSeries.length,
      oversize: why.oversize,
      otherwiseRefused: why.unreadable + why.small + why.badGeometry,
      capped,
    });
    return { ok: false, error: `No DICOM volume found in ${filesN(total)}`, scanned: total, reasons, headline };
  }
  volumes.sort((a, b) => a.label.localeCompare(b.label));
  // no two catalog rows may share an id (CbctApp treats a known id as already open)
  const unique = volumes.filter((v, i) => volumes.findIndex((w) => w.id === v.id) === i);
  return { ok: true, label: sourceLabel, volumes: unique };
}
