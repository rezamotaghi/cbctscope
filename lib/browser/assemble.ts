// BROWSER. Assembly of an opened volume into the shared contract (Int16 HU voxels, x-fastest /
// y / z-ascending, plus geometry), the port of localSource.ts's assemblers. Pure apart from
// reading the File objects it is handed, so it runs unchanged in the assembly worker
// (assemble.worker.ts, the normal path) and directly in tests or as the fallback when a
// Worker cannot be created.
import dicomParser from 'dicom-parser';
import { TAG, ippVec, ippZ, pxToInt16, robustVoi, type CbctVolumeMeta, type VoxelVolume } from '../shared/dicom';
import { generatePhantom } from '../shared/phantom';
import { normalizeRadiographFrame } from '../shared/radiograph';
import { XTAG, type BrowserVolume } from './scan';

export type AssembleJob = { kind: 'phantom' } | { kind: 'volume'; volume: BrowserVolume };

export type Progress = (fraction: number) => void;

async function readAll(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
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

const midSlice = (out: Int16Array, frameLen: number, frames: number) =>
  out.subarray(Math.floor(frames / 2) * frameLen, (Math.floor(frames / 2) + 1) * frameLen);

async function assembleMultiframe(v: BrowserVolume, onProgress?: Progress): Promise<VoxelVolume> {
  const buf = await readAll(v.files[0]);
  onProgress?.(0.3);
  const ds = dicomParser.parseDicom(buf);
  const rows = ds.uint16(TAG.rows) ?? v.dims[1];
  const cols = ds.uint16(TAG.cols) ?? v.dims[0];
  const frames = Number(ds.string(TAG.frames) ?? v.dims[2]) || v.dims[2];
  const slope = Number(ds.string(TAG.slope) ?? 1) || 1;
  const intercept = Number(ds.string(TAG.intercept) ?? 0);
  const signed = (ds.uint16(XTAG.pixelRep) ?? 0) === 1;

  // per-frame plane positions: first, second, last give z direction + origin (the viewer
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
  if (pixelEl.dataOffset + frameLen * frames * 2 > buf.byteLength) throw new Error('pixel data is truncated');
  const out = new Int16Array(frameLen * frames);
  for (let f = 0; f < frames; f++) {
    const srcF = ascending ? f : frames - 1 - f;
    const px = pxToInt16(buf, pixelEl.dataOffset + srcF * frameLen * 2, frameLen * 2, signed);
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
    const buf = await readAll(v.files[f]);
    const ds = dicomParser.parseDicom(buf);
    if (f === 0) {
      rows = ds.uint16(TAG.rows) ?? rows;
      cols = ds.uint16(TAG.cols) ?? cols;
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
    const el = ds.elements[TAG.pixelData];
    if (!el) throw new Error(`slice ${f}: no pixel data`);
    if (el.dataOffset + frameLen * 2 > buf.byteLength) throw new Error(`slice ${f}: pixel data is truncated`);
    const px = pxToInt16(buf, el.dataOffset, frameLen * 2, signed);
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
  const buf = await readAll(v.files[0]);
  const ds = dicomParser.parseDicom(buf);
  const rows = ds.uint16(TAG.rows) ?? v.dims[1];
  const cols = ds.uint16(TAG.cols) ?? v.dims[0];
  const slope = Number(ds.string(TAG.slope) ?? 1) || 1;
  const intercept = Number(ds.string(TAG.intercept) ?? 0);
  const signed = (ds.uint16(XTAG.pixelRep) ?? 0) === 1;
  const pixelEl = ds.elements[TAG.pixelData];
  if (!pixelEl) throw new Error('no pixel data');
  if (pixelEl.dataOffset + rows * cols * 2 > buf.byteLength) throw new Error('pixel data is truncated');
  const px = pxToInt16(buf, pixelEl.dataOffset, rows * cols * 2, signed);
  const out = normalizeRadiographFrame(px, { slope, intercept, monochrome1: !!v.mono1 });
  onProgress?.(1);
  return {
    meta: metaOf(v, [cols, rows, 1], [0, 0, 0], robustVoi(out), out.byteLength),
    voxels: out,
  };
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
