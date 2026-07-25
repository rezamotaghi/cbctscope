'use client';
// Export encoders for the CBCT viewer — the "get it OUT in a universal format" layer.
// All pure client-side, straight off the cached Int16 HU buffer (volumeData.ts), so they
// work identically in every view mode:
//   - PNG slice stacks (.zip)  what-you-see 8-bit slices, window/invert/gamma baked in
//   - NIfTI (.nii.gz)          the research/ML volume format: raw 16-bit HU + geometry
//   - binary STL (.stl)        surface mesh at an HU threshold (marching cubes) for 3D
//                              printing/CAD; honors the 3D crop box
// (The fourth door — de-identified source DICOM — is a server passthrough route, not here.)
// The writers are dependency-free (NIfTI = fixed 348-byte header; STL = fixed records; zip
// via lib/zipStore); the one library piece is vtk.js marching cubes, already in node_modules
// as Cornerstone's dependency (API verified in its source — world-coordinate points).
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import { zipStore, type ZipEntry } from '@/lib/zipStore';
import type { VolumeEntry } from './volumeData';
import type { Crop3d } from './CbctViewport';

export interface ExportWindow {
  lower: number;
  upper: number;
  gamma: number;
  invert: boolean;
}

export type SlicePlane = 'axial' | 'sagittal' | 'coronal';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // revoke on a delay — Safari cancels the download if the URL dies immediately
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ---------------------------------------------------------------------------
// PNG slice stacks

/** 16-bit HU → 8-bit display LUT (same mapping as renderOblique: window, gamma, invert). */
export function buildLut(win: ExportWindow): Uint8Array {
  const lut = new Uint8Array(65536);
  const range = Math.max(1, win.upper - win.lower);
  const invGamma = 1 / Math.max(0.05, win.gamma);
  for (let v = -32768; v < 32768; v++) {
    let t = (v - win.lower) / range;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (win.gamma !== 1) t = Math.pow(t, invGamma);
    if (win.invert) t = 1 - t;
    lut[v + 32768] = Math.round(t * 255);
  }
  return lut;
}

/**
 * One slice as display-windowed ImageData, oriented like the viewer panes:
 * axial — patient left on image right, anterior at top; coronal — patient left on image
 * right, superior at top; sagittal — anterior on image left, superior at top.
 * (Voxel order is x-fastest/y/z-ascending in LPS, so axial reads rows directly; the other
 * two flip z so superior lands at the top.)
 */
export function sliceImage(entry: VolumeEntry, plane: SlicePlane, idx: number, lut: Uint8Array): ImageData {
  const [nx, ny, nz] = entry.meta.dims;
  const nxy = nx * ny;
  const s = entry.scalar;
  const w = plane === 'axial' ? nx : plane === 'coronal' ? nx : ny;
  const h = plane === 'axial' ? ny : nz;
  const img = new ImageData(w, h);
  const px = img.data;
  for (let r = 0; r < h; r++) {
    const rowOff = r * w * 4;
    for (let c = 0; c < w; c++) {
      const v =
        plane === 'axial'
          ? s[idx * nxy + r * nx + c]
          : plane === 'coronal'
            ? s[(nz - 1 - r) * nxy + idx * nx + c]
            : s[(nz - 1 - r) * nxy + c * nx + idx];
      const g8 = lut[v + 32768];
      const o = rowOff + c * 4;
      px[o] = g8;
      px[o + 1] = g8;
      px[o + 2] = g8;
      px[o + 3] = 255;
    }
  }
  return img;
}

/** ImageData → PNG bytes; scaleY corrects sag/cor aspect when z-spacing ≠ xy-spacing. */
export async function pngBytes(img: ImageData, scaleY: number): Promise<Uint8Array> {
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  cv.getContext('2d')!.putImageData(img, 0, 0);
  let out = cv;
  if (Math.abs(scaleY - 1) > 0.01) {
    out = document.createElement('canvas');
    out.width = img.width;
    out.height = Math.max(2, Math.round(img.height * scaleY));
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cv, 0, 0, out.width, out.height);
  }
  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'));
  if (!blob) throw new Error('PNG encode failed');
  return new Uint8Array(await blob.arrayBuffer());
}

export interface SliceStackOptions {
  planes: SlicePlane[];
  everyNth: number; // 1 = every slice
  window: ExportWindow;
}

/**
 * Render the chosen planes into one .zip of PNGs (+ a meta.json that makes the stack
 * self-describing). Filenames carry the ORIGINAL slice index along that axis, zero-padded,
 * so a file maps straight back to the viewer position. toBlob is async per slice, so the
 * UI keeps painting between slices; onProgress feeds the busy line.
 */
export async function exportSliceStack(
  entry: VolumeEntry,
  opts: SliceStackOptions,
  onProgress: (msg: string) => void,
): Promise<Blob> {
  const [nx, ny, nz] = entry.meta.dims;
  const [sx, , sz] = entry.meta.spacing;
  const lut = buildLut(opts.window);
  const n = Math.max(1, Math.round(opts.everyNth));
  const counts: Record<SlicePlane, number> = { axial: nz, sagittal: nx, coronal: ny };
  const entries: ZipEntry[] = [];
  const planeCounts: Partial<Record<SlicePlane, number>> = {};
  let done = 0;
  const total = opts.planes.reduce((a, p) => a + Math.ceil(counts[p] / n), 0);
  for (const plane of opts.planes) {
    const scaleY = plane === 'axial' ? 1 : sz / sx; // sag/cor rows are z-steps
    let count = 0;
    for (let i = 0; i < counts[plane]; i += n) {
      const bytes = await pngBytes(sliceImage(entry, plane, i, lut), scaleY);
      entries.push({ name: `${plane}/${String(i).padStart(4, '0')}.png`, data: bytes });
      count++;
      done++;
      if (done % 10 === 0 || done === total) onProgress(`rendering slices ${done}/${total}…`);
    }
    planeCounts[plane] = count;
  }
  const meta = {
    schema: 'cbctscope-slice-export-v1',
    anon: entry.meta.anon,
    dims: entry.meta.dims,
    spacing_mm: entry.meta.spacing,
    origin_mm: entry.meta.origin,
    window: opts.window,
    every_nth: n,
    planes: planeCounts,
    note: 'filenames carry the original slice index along that axis; window/invert/gamma are baked into the pixels (full-fidelity voxels live in the NIfTI/DICOM exports)',
  };
  entries.unshift({ name: 'meta.json', data: new TextEncoder().encode(JSON.stringify(meta, null, 2)) });
  onProgress('zipping…');
  return new Blob(zipStore(entries) as BlobPart[], { type: 'application/zip' });
}

// ---------------------------------------------------------------------------
// NIfTI volume

/**
 * NIfTI-1 single-file volume (.nii): a fixed 348-byte binary header + 4 extender bytes +
 * the raw Int16 HU voxels. The affine (sform) maps voxel indices to physical mm: our voxel
 * axes are LPS (+x left, +y posterior, +z superior — the whole viewer assumes axis-aligned
 * acquisition, as does this) and NIfTI wants RAS (+x RIGHT, +y ANTERIOR), so x and y rows
 * flip sign. cal_min/max carry the volume's default window as a display hint (Slicer/ITK
 * open with a sane window instead of full-range gray).
 */
export function encodeNiftiParts(entry: VolumeEntry): BlobPart[] {
  const [nx, ny, nz] = entry.meta.dims;
  const [sx, sy, sz] = entry.meta.spacing;
  const [ox, oy, oz] = entry.meta.origin;
  const voi = entry.meta.defaultVoi;
  const hdr = new ArrayBuffer(352);
  const dv = new DataView(hdr);
  dv.setInt32(0, 348, true); // sizeof_hdr
  dv.setInt16(40, 3, true); // dim[0]: 3 spatial dimensions
  dv.setInt16(42, nx, true);
  dv.setInt16(44, ny, true);
  dv.setInt16(46, nz, true);
  for (let i = 4; i < 8; i++) dv.setInt16(40 + i * 2, 1, true);
  dv.setInt16(70, 4, true); // datatype: DT_INT16
  dv.setInt16(72, 16, true); // bitpix
  dv.setFloat32(76, 1, true); // pixdim[0] (qfac — unused, qform_code 0)
  dv.setFloat32(80, sx, true);
  dv.setFloat32(84, sy, true);
  dv.setFloat32(88, sz, true);
  dv.setFloat32(108, 352, true); // vox_offset
  dv.setFloat32(112, 1, true); // scl_slope (HU are already physical)
  dv.setFloat32(116, 0, true); // scl_inter
  dv.setUint8(123, 2); // xyzt_units: NIFTI_UNITS_MM
  dv.setFloat32(124, voi.center + voi.width / 2, true); // cal_max
  dv.setFloat32(128, voi.center - voi.width / 2, true); // cal_min
  const desc = 'CBCTScope CBCT export (de-identified HU volume)';
  for (let i = 0; i < Math.min(79, desc.length); i++) dv.setUint8(148 + i, desc.charCodeAt(i));
  dv.setInt16(252, 0, true); // qform_code: none
  dv.setInt16(254, 1, true); // sform_code: scanner-anatomical
  dv.setFloat32(280, -sx, true); // srow_x = [-sx, 0, 0, -ox]  (LPS→RAS sign flip)
  dv.setFloat32(292, -ox, true);
  dv.setFloat32(300, -sy, true); // srow_y = [0, -sy, 0, -oy]
  dv.setFloat32(308, -oy, true);
  dv.setFloat32(320, sz, true); //  srow_z = [0, 0, sz, oz]
  dv.setFloat32(324, oz, true);
  dv.setUint8(344, 0x6e); // magic "n+1\0"
  dv.setUint8(345, 0x2b);
  dv.setUint8(346, 0x31);
  // bytes 348..351 (extension flag) stay zero: no extensions
  // the scalar buffer is a plain ArrayBuffer at runtime — TS just can't prove it isn't shared
  const data = new Uint8Array(
    entry.scalar.buffer,
    entry.scalar.byteOffset,
    entry.scalar.byteLength,
  ) as Uint8Array<ArrayBuffer>;
  return [hdr, data];
}

/** gzip the .nii into a .nii.gz via the browser's built-in compressor (with a plain-.nii fallback). */
export async function exportNifti(entry: VolumeEntry): Promise<{ blob: Blob; ext: 'nii.gz' | 'nii' }> {
  const parts = encodeNiftiParts(entry);
  if (typeof CompressionStream === 'undefined') {
    return { blob: new Blob(parts, { type: 'application/octet-stream' }), ext: 'nii' };
  }
  const gz = new Blob(parts).stream().pipeThrough(new CompressionStream('gzip'));
  return { blob: await new Response(gz).blob(), ext: 'nii.gz' };
}

// ---------------------------------------------------------------------------
// STL surface (marching cubes)

export interface StlOptions {
  thresholdHU: number;
  /** cap on the longest axis fed to marching cubes (0 = full resolution) */
  maxDim: number;
  /** honor the MPR 3D crop box (fractions per axis) — null = whole volume */
  crop: Crop3d | null;
}

/**
 * Bone/tooth surface at an HU threshold as binary STL (mm units — what every print slicer
 * expects). Marching cubes runs on a cropped + strided copy of the volume: the stride cap
 * keeps the (synchronous) triangulation interactive; vertices come out in world mm because
 * vtk's filter respects the spacing/origin we set. Triangle winding is oriented against the
 * filter's gradient point-normals so faces consistently point OUT of the dense structure —
 * print slicers care about that.
 */
export function exportStl(entry: VolumeEntry, opts: StlOptions): { blob: Blob; triangles: number } {
  const [nx, ny, nz] = entry.meta.dims;
  const [sx, sy, sz] = entry.meta.spacing;
  const [ox, oy, oz] = entry.meta.origin;
  const nxy = nx * ny;
  const s = entry.scalar;
  // crop box → voxel index ranges (≥2 voxels per axis so a cell exists)
  const cl = (f: number, n: number) => Math.min(n - 2, Math.max(0, Math.floor(f * n)));
  const ch = (f: number, n: number, lo: number) => Math.max(lo + 2, Math.min(n, Math.ceil(f * n)));
  const x0 = cl(opts.crop?.x[0] ?? 0, nx);
  const x1 = ch(opts.crop?.x[1] ?? 1, nx, x0);
  const y0 = cl(opts.crop?.y[0] ?? 0, ny);
  const y1 = ch(opts.crop?.y[1] ?? 1, ny, y0);
  const z0 = cl(opts.crop?.z[0] ?? 0, nz);
  const z1 = ch(opts.crop?.z[1] ?? 1, nz, z0);
  const span = Math.max(x1 - x0, y1 - y0, z1 - z0);
  const q = opts.maxDim > 0 ? Math.max(1, Math.ceil(span / opts.maxDim)) : 1;
  const dx = Math.max(2, Math.floor((x1 - x0) / q));
  const dy = Math.max(2, Math.floor((y1 - y0) / q));
  const dz = Math.max(2, Math.floor((z1 - z0) / q));
  const cropped = new Int16Array(dx * dy * dz);
  for (let z = 0; z < dz; z++) {
    const zi = (z0 + z * q) * nxy;
    for (let y = 0; y < dy; y++) {
      const yi = zi + (y0 + y * q) * nx;
      const base = (z * dy + y) * dx;
      for (let x = 0; x < dx; x++) cropped[base + x] = s[yi + x0 + x * q];
    }
  }
  const img = vtkImageData.newInstance();
  img.setDimensions(dx, dy, dz);
  img.setSpacing([sx * q, sy * q, sz * q]);
  img.setOrigin([ox + x0 * sx, oy + y0 * sy, oz + z0 * sz]);
  img.getPointData().setScalars(
    vtkDataArray.newInstance({ numberOfComponents: 1, values: cropped, name: 'HU' }),
  );
  const mc = vtkImageMarchingCubes.newInstance({
    contourValue: opts.thresholdHU,
    computeNormals: true, // gradient normals — used below to orient the winding
    mergePoints: true,
  });
  mc.setInputData(img);
  const pd = mc.getOutputData();
  const pts = pd.getPoints().getData() as Float32Array;
  const polys = pd.getPolys().getData() as Uint32Array;
  const nrm = pd.getPointData().getNormals()?.getData() as Float32Array | undefined;

  // count triangles (vtk cell array layout: [3, a, b, c, 3, ...])
  let tris = 0;
  for (let i = 0; i < polys.length; i += polys[i] + 1) if (polys[i] === 3) tris++;
  const buf = new ArrayBuffer(84 + 50 * tris);
  const dv = new DataView(buf);
  const header = `CBCTScope CBCT surface @ ${opts.thresholdHU} HU, mm units`; // ASCII only — STL header is raw bytes
  for (let i = 0; i < Math.min(79, header.length); i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, tris, true);
  let o = 84;
  for (let i = 0; i < polys.length; i += polys[i] + 1) {
    if (polys[i] !== 3) continue;
    const a = polys[i + 1];
    let b = polys[i + 2];
    let c = polys[i + 3];
    const ax = pts[a * 3];
    const ay = pts[a * 3 + 1];
    const az = pts[a * 3 + 2];
    let fx = (pts[b * 3 + 1] - ay) * (pts[c * 3 + 2] - az) - (pts[b * 3 + 2] - az) * (pts[c * 3 + 1] - ay);
    let fy = (pts[b * 3 + 2] - az) * (pts[c * 3] - ax) - (pts[b * 3] - ax) * (pts[c * 3 + 2] - az);
    let fz = (pts[b * 3] - ax) * (pts[c * 3 + 1] - ay) - (pts[b * 3 + 1] - ay) * (pts[c * 3] - ax);
    if (nrm) {
      // flip the face if it disagrees with the summed vertex normals (outward = down-gradient)
      const dot =
        fx * (nrm[a * 3] + nrm[b * 3] + nrm[c * 3]) +
        fy * (nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1]) +
        fz * (nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2]);
      if (dot < 0) {
        const t = b;
        b = c;
        c = t;
        fx = -fx;
        fy = -fy;
        fz = -fz;
      }
    }
    const len = Math.hypot(fx, fy, fz) || 1;
    dv.setFloat32(o, fx / len, true);
    dv.setFloat32(o + 4, fy / len, true);
    dv.setFloat32(o + 8, fz / len, true);
    dv.setFloat32(o + 12, pts[a * 3], true);
    dv.setFloat32(o + 16, pts[a * 3 + 1], true);
    dv.setFloat32(o + 20, pts[a * 3 + 2], true);
    dv.setFloat32(o + 24, pts[b * 3], true);
    dv.setFloat32(o + 28, pts[b * 3 + 1], true);
    dv.setFloat32(o + 32, pts[b * 3 + 2], true);
    dv.setFloat32(o + 36, pts[c * 3], true);
    dv.setFloat32(o + 40, pts[c * 3 + 1], true);
    dv.setFloat32(o + 44, pts[c * 3 + 2], true);
    dv.setUint16(o + 48, 0, true);
    o += 50;
  }
  return { blob: new Blob([buf], { type: 'model/stl' }), triangles: tris };
}
