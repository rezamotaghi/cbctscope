// BROWSER. Assembly of an opened volume into the shared contract (Int16 HU voxels, x-fastest /
// y / z-ascending, plus geometry), the port of localSource.ts's assemblers. Pure apart from
// reading the File objects it is handed, so it runs unchanged in the assembly worker
// (assemble.worker.ts, the normal path) and directly in tests or as the fallback when a
// Worker cannot be created.
import type dicomParser from 'dicom-parser';
import { TAG, ippVec, ippZ, pxToInt16, robustVoi, type CbctVolumeMeta, type VoxelVolume } from '../shared/dicom';
import { assertPixelRange, MAX_VOLUME_BYTES, positiveDim, positiveIntTag } from '../shared/dicomScan';
import { generatePhantom } from '../shared/phantom';
import { normalizeRadiographFrame } from '../shared/radiograph';
import { parseHead, XTAG, type BrowserVolume } from './scan';

export type AssembleJob = { kind: 'phantom' } | { kind: 'volume'; volume: BrowserVolume };

export type Progress = (fraction: number) => void;

/** Rows and Columns of a parsed header, both positive, or a plain error */
function dimsOf(ds: dicomParser.DataSet): { rows: number; cols: number } {
  const rows = ds.uint16(TAG.rows);
  const cols = ds.uint16(TAG.cols);
  if (!positiveDim(rows) || !positiveDim(cols)) throw new Error('Rows or Columns missing or zero');
  return { rows, cols };
}

/**
 * The header and exactly the pixel bytes it promises: the header from the file's first
 * megabytes (parseHead), then only the range dataOffset to dataOffset + expected through
 * File.slice. Never the whole file: a file padded far beyond its pixel data costs nothing, and
 * one shorter than the promised range is refused before anything is allocated. The 1.5 GB
 * guard compares against the expected bytes, the figure that is actually read.
 */
export async function readPixelRange(
  file: File,
  expected: (ds: dicomParser.DataSet) => number,
): Promise<{ ds: dicomParser.DataSet; px: Uint8Array }> {
  const ds = await parseHead(file);
  if (!ds) throw new Error('DICOM header unreadable');
  const el = ds.elements[TAG.pixelData];
  if (!el) throw new Error('no pixel data');
  const bytes = expected(ds);
  if (bytes > MAX_VOLUME_BYTES) throw new Error('over the 1.5 GB size guard');
  assertPixelRange(el.dataOffset, bytes, file.size);
  const px = new Uint8Array(await file.slice(el.dataOffset, el.dataOffset + bytes).arrayBuffer());
  if (px.byteLength !== bytes) throw new Error('pixel data is truncated');
  return { ds, px };
}

function metaOf(
  v: BrowserVolume,
  dims: [number, number, number],
  origin: [number, number, number],
  voi: { center: number; width: number },
  bytes: number,
): CbctVolumeMeta {
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

/**
 * A multiframe file's z direction and origin from its per-frame plane positions (first,
 * second, last); the viewer always receives z-ASCENDING voxels.
 */
export function mfGeometry(
  ds: dicomParser.DataSet,
  frames: number,
  zSpacing: number,
): { origin: [number, number, number]; ascending: boolean } {
  const pf = ds.elements[TAG.perFrameFG];
  let z0 = 0;
  let z1 = zSpacing;
  let zLast = zSpacing * (frames - 1);
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
  return { origin: [origin[0], origin[1], Math.min(z0, zLast)], ascending: z1 >= z0 };
}

const midSlice = (out: Int16Array, frameLen: number, frames: number) =>
  out.subarray(Math.floor(frames / 2) * frameLen, (Math.floor(frames / 2) + 1) * frameLen);

async function assembleMultiframe(v: BrowserVolume, onProgress?: Progress): Promise<VoxelVolume> {
  let rows = 0;
  let cols = 0;
  let frames = 0;
  const { ds, px: buf } = await readPixelRange(v.files[0], (head) => {
    ({ rows, cols } = dimsOf(head));
    const n = positiveIntTag(head.string(TAG.frames), v.dims[2]);
    if (n === null) throw new Error('NumberOfFrames is not a positive whole number');
    frames = n;
    return rows * cols * frames * 2;
  });
  onProgress?.(0.3);
  const slope = Number(ds.string(TAG.slope) ?? 1) || 1;
  const intercept = Number(ds.string(TAG.intercept) ?? 0);
  const signed = (ds.uint16(XTAG.pixelRep) ?? 0) === 1;

  const { origin, ascending } = mfGeometry(ds, frames, v.spacing[2]);

  const frameLen = rows * cols;
  const out = new Int16Array(frameLen * frames);
  for (let f = 0; f < frames; f++) {
    const srcF = ascending ? f : frames - 1 - f;
    const px = pxToInt16(buf, srcF * frameLen * 2, frameLen * 2, signed);
    const base = f * frameLen;
    for (let i = 0; i < frameLen; i++) out[base + i] = px[i] * slope + intercept;
    if ((f & 15) === 15) onProgress?.(0.3 + (0.7 * (f + 1)) / frames);
  }
  onProgress?.(1);
  return {
    meta: metaOf(v, [cols, rows, frames], origin, robustVoi(midSlice(out, frameLen, frames)), out.byteLength),
    voxels: out,
  };
}

async function assembleSlices(v: BrowserVolume, onProgress?: Progress): Promise<VoxelVolume> {
  // the scan sorted the files z-ascending by their headers; one file is resident at a time
  const n = v.files.length;
  let rows = v.dims[1];
  let cols = v.dims[0];
  let slope = 1;
  let intercept = 0;
  let signed = false;
  let origin: [number, number, number] = [0, 0, 0];
  let out: Int16Array | null = null;
  let frameLen = rows * cols;
  let prevZ = -Infinity;
  for (let f = 0; f < n; f++) {
    const { ds, px: buf } = await readPixelRange(v.files[f], (head) => {
      if (f === 0) ({ rows, cols } = dimsOf(head));
      return rows * cols * 2;
    }).catch((err: unknown) => {
      throw new Error(`slice ${f}: ${err instanceof Error ? err.message : String(err)}`);
    });
    if (f === 0) {
      slope = Number(ds.string(TAG.slope) ?? 1) || 1;
      intercept = Number(ds.string(TAG.intercept) ?? 0);
      signed = (ds.uint16(XTAG.pixelRep) ?? 0) === 1;
      origin = ippVec(ds);
      frameLen = rows * cols;
      out = new Int16Array(frameLen * n);
    }
    const z = ippZ(ds);
    if (z < prevZ) throw new Error(`slice ${f}: out of z order`);
    prevZ = z;
    const px = pxToInt16(buf, 0, frameLen * 2, signed);
    const base = f * frameLen;
    for (let i = 0; i < frameLen; i++) out![base + i] = px[i] * slope + intercept;
    onProgress?.((f + 1) / n);
  }
  const vox = out ?? new Int16Array(0);
  return {
    meta: metaOf(v, [cols, rows, n], origin, robustVoi(midSlice(vox, frameLen, n)), vox.byteLength),
    voxels: vox,
  };
}

async function assembleRadiograph(v: BrowserVolume, onProgress?: Progress): Promise<VoxelVolume> {
  let rows = 0;
  let cols = 0;
  const { ds, px: buf } = await readPixelRange(v.files[0], (head) => {
    ({ rows, cols } = dimsOf(head));
    return rows * cols * 2;
  });
  const slope = Number(ds.string(TAG.slope) ?? 1) || 1;
  const intercept = Number(ds.string(TAG.intercept) ?? 0);
  const signed = (ds.uint16(XTAG.pixelRep) ?? 0) === 1;
  const px = pxToInt16(buf, 0, rows * cols * 2, signed);
  const out = normalizeRadiographFrame(px, { slope, intercept, monochrome1: !!v.mono1 });
  onProgress?.(1);
  return {
    meta: metaOf(v, [cols, rows, 1], [0, 0, 0], robustVoi(out), out.byteLength),
    voxels: out,
  };
}

/** HU values of one stored frame: rescale applied, as the assemblers do */
function huFrame(raw: Uint8Array, offset: number, frameLen: number, signed: boolean, slope: number, intercept: number): Int16Array {
  const px = pxToInt16(raw, offset, frameLen * 2, signed);
  const out = new Int16Array(frameLen);
  for (let i = 0; i < frameLen; i++) out[i] = px[i] * slope + intercept;
  return out;
}

/**
 * The geometry of an opened volume without assembling it: dims, spacing and bytes from the
 * scan, the origin from the header, and the default window from the one middle slice the
 * assembled volume would take it from (same robustVoi, same slice, so the same numbers). Reads
 * a header and one frame; never the whole volume. The catalog verb of the desktop app and the
 * room's first paint both ask for this.
 */
export async function volumeMeta(v: BrowserVolume): Promise<CbctVolumeMeta> {
  const [cols, rows, n] = v.dims;
  const frameLen = rows * cols;
  const bytes = frameLen * n * 2;
  if (v.kind === 'slices') {
    const first = await parseHead(v.files[0]);
    if (!first) throw new Error('slice 0: DICOM header unreadable');
    const mid = Math.floor(n / 2);
    const { ds, px } = await readPixelRange(v.files[mid], () => frameLen * 2);
    const slope = Number(ds.string(TAG.slope) ?? 1) || 1;
    const intercept = Number(ds.string(TAG.intercept) ?? 0);
    // the assembler takes the sign from the first slice
    const signed = (first.uint16(XTAG.pixelRep) ?? 0) === 1;
    return metaOf(v, v.dims, ippVec(first), robustVoi(huFrame(px, 0, frameLen, signed, slope, intercept)), bytes);
  }
  const ds = await parseHead(v.files[0]);
  if (!ds) throw new Error('DICOM header unreadable');
  const el = ds.elements[TAG.pixelData];
  if (!el) throw new Error('no pixel data');
  const slope = Number(ds.string(TAG.slope) ?? 1) || 1;
  const intercept = Number(ds.string(TAG.intercept) ?? 0);
  const signed = (ds.uint16(XTAG.pixelRep) ?? 0) === 1;
  assertPixelRange(el.dataOffset, bytes, v.files[0].size);
  if (v.kind === 'xray') {
    const raw = new Uint8Array(await v.files[0].slice(el.dataOffset, el.dataOffset + frameLen * 2).arrayBuffer());
    const px = pxToInt16(raw, 0, frameLen * 2, signed);
    const out = normalizeRadiographFrame(px, { slope, intercept, monochrome1: !!v.mono1 });
    return metaOf(v, v.dims, [0, 0, 0], robustVoi(out), out.byteLength);
  }
  const { origin, ascending } = mfGeometry(ds, n, v.spacing[2]);
  const mid = Math.floor(n / 2);
  const srcF = ascending ? mid : n - 1 - mid;
  const start = el.dataOffset + srcF * frameLen * 2;
  const raw = new Uint8Array(await v.files[0].slice(start, start + frameLen * 2).arrayBuffer());
  return metaOf(v, v.dims, origin, robustVoi(huFrame(raw, 0, frameLen, signed, slope, intercept)), bytes);
}

/** Run one assembly job: an opened volume, or the synthetic phantom. */
export async function assemble(job: AssembleJob, onProgress?: Progress): Promise<VoxelVolume> {
  if (job.kind === 'phantom') {
    const vol = generatePhantom();
    onProgress?.(1);
    return vol;
  }
  const v = job.volume;
  if (v.kind === 'mf') return assembleMultiframe(v, onProgress);
  if (v.kind === 'xray') return assembleRadiograph(v, onProgress);
  return assembleSlices(v, onProgress);
}
