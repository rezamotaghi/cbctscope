// Synthetic DICOM for the loader tests, written from the synthetic phantom only: no patient
// data exists anywhere in this file or its output. Explicit VR little endian, Part 10 preamble
// + DICM + meta group, the minimal tags the scanner and assemblers read.
//
// Output goes ONLY into a caller-made temp directory under os.tmpdir() (see makeTempDir);
// nothing imaging-shaped is ever written inside the checkout (AGENTS.md, hard rule 3).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generatePhantom } from '../../lib/shared/phantom';

// ---------------------------------------------------------------------------
// element encoding

interface El {
  tag: number; // (group << 16) | element
  vr: string;
  value: Uint8Array;
}

const LONG_VRS = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN']);
const enc = new TextEncoder();

function padEven(bytes: Uint8Array, pad: number): Uint8Array {
  if (bytes.length % 2 === 0) return bytes;
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes);
  out[bytes.length] = pad;
  return out;
}

const tagOf = (g: number, e: number) => ((g << 16) | e) >>> 0;
const str = (g: number, e: number, vr: string, s: string): El => ({
  tag: tagOf(g, e),
  vr,
  value: padEven(enc.encode(s), vr === 'UI' ? 0 : 0x20),
});
const us = (g: number, e: number, n: number): El => {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return { tag: tagOf(g, e), vr: 'US', value: b };
};
const ul = (g: number, e: number, n: number): El => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return { tag: tagOf(g, e), vr: 'UL', value: b };
};
const ob = (g: number, e: number, bytes: Uint8Array, vr = 'OB'): El => ({ tag: tagOf(g, e), vr, value: padEven(bytes, 0) });

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function encodeElements(els: El[]): Uint8Array {
  const sorted = [...els].sort((a, b) => a.tag - b.tag);
  return concat(
    sorted.map((el) => {
      const long = LONG_VRS.has(el.vr);
      const head = new Uint8Array(long ? 12 : 8);
      const dv = new DataView(head.buffer);
      dv.setUint16(0, el.tag >>> 16, true);
      dv.setUint16(2, el.tag & 0xffff, true);
      head[4] = el.vr.charCodeAt(0);
      head[5] = el.vr.charCodeAt(1);
      if (long) dv.setUint32(8, el.value.length, true);
      else dv.setUint16(6, el.value.length, true);
      return concat([head, el.value]);
    }),
  );
}

/** a sequence of defined-length items */
function sq(g: number, e: number, items: El[][]): El {
  const body = concat(
    items.map((item) => {
      const content = encodeElements(item);
      const head = new Uint8Array(8);
      const dv = new DataView(head.buffer);
      dv.setUint16(0, 0xfffe, true);
      dv.setUint16(2, 0xe000, true);
      dv.setUint32(4, content.length, true);
      return concat([head, content]);
    }),
  );
  return { tag: tagOf(g, e), vr: 'SQ', value: body };
}

const EXPLICIT_LE = '1.2.840.10008.1.2.1';

/** Part 10 file: 128-byte preamble, DICM, the meta group, then the dataset. */
export function part10(sopClass: string, sopInstance: string, dataset: El[], ts = EXPLICIT_LE): Uint8Array<ArrayBuffer> {
  const metaBody = encodeElements([
    ob(0x0002, 0x0001, Uint8Array.from([0, 1])),
    str(0x0002, 0x0002, 'UI', sopClass),
    str(0x0002, 0x0003, 'UI', sopInstance),
    str(0x0002, 0x0010, 'UI', ts),
    str(0x0002, 0x0012, 'UI', '2.25.424242'),
  ]);
  const metaLen = encodeElements([ul(0x0002, 0x0000, metaBody.length)]);
  const preamble = new Uint8Array(132);
  preamble.set(enc.encode('DICM'), 128);
  return concat([
    preamble,
    metaLen,
    metaBody,
    encodeElements([...dataset, str(0x0008, 0x0016, 'UI', sopClass), str(0x0008, 0x0018, 'UI', sopInstance)]),
  ]);
}

// ---------------------------------------------------------------------------
// the downsampled phantom: 64^3, every 4th column and row, every 3rd slice from k = 4

export const N = 64;
export const SPACING: [number, number, number] = [1.6, 1.6, 1.2];
export const ORIGIN: [number, number, number] = [-51.2, 0, 4.8];

let sampled: Int16Array | null = null;

/** HU voxels of the 64^3 phantom sample, x-fastest / y / z-ascending */
export function phantomSample(): Int16Array {
  if (sampled) return sampled;
  const { meta, voxels } = generatePhantom();
  const [nx, ny] = meta.dims;
  const out = new Int16Array(N * N * N);
  for (let c = 0; c < N; c++)
    for (let b = 0; b < N; b++)
      for (let a = 0; a < N; a++) out[c * N * N + b * N + a] = voxels[(4 + 3 * c) * nx * ny + 4 * b * nx + 4 * a];
  sampled = out;
  return out;
}

/** one z slice of the sample as stored pixel bytes: unsigned (HU + 1024) or signed (HU) */
function slicePixels(c: number, signed: boolean): Uint8Array {
  const vox = phantomSample();
  const out = new Uint8Array(N * N * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < N * N; i++) {
    const hu = vox[c * N * N + i];
    if (signed) dv.setInt16(i * 2, hu, true);
    else dv.setUint16(i * 2, hu + 1024, true);
  }
  return out;
}

const zOf = (c: number) => +(ORIGIN[2] + c * SPACING[2]).toFixed(3);
const ipp = (c: number) => `${ORIGIN[0]}\\${ORIGIN[1]}\\${zOf(c)}`;

function imageTags(o: { rows: number; cols: number; signed: boolean; intercept: number; photometric?: string }): El[] {
  return [
    us(0x0028, 0x0002, 1),
    str(0x0028, 0x0004, 'CS', o.photometric ?? 'MONOCHROME2'),
    us(0x0028, 0x0010, o.rows),
    us(0x0028, 0x0011, o.cols),
    us(0x0028, 0x0100, 16),
    us(0x0028, 0x0101, 16),
    us(0x0028, 0x0102, 15),
    us(0x0028, 0x0103, o.signed ? 1 : 0),
    str(0x0028, 0x1052, 'DS', String(o.intercept)),
    str(0x0028, 0x1053, 'DS', '1'),
  ];
}

const CT_IMAGE = '1.2.840.10008.5.1.4.1.1.2';
const ENHANCED_CT = '1.2.840.10008.5.1.4.1.1.2.1';
const DX_PRESENTATION = '1.2.840.10008.5.1.4.1.1.1.1';

// ---------------------------------------------------------------------------
// the four shapes

/** One Enhanced-CT multiframe file holding all 64 slices, frames stored z-DESCENDING. */
export function multiframeBytes(
  o: { rows?: number; cols?: number; frames?: number; pixelBytes?: Uint8Array; framesTag?: string; sopUid?: string } = {},
): Uint8Array<ArrayBuffer> {
  const rows = o.rows ?? N;
  const cols = o.cols ?? N;
  const frames = o.frames ?? N;
  const pixels =
    o.pixelBytes ??
    concat(Array.from({ length: frames }, (_, f) => slicePixels(frames - 1 - f, false))); // descending z
  const perFrame = Array.from({ length: frames }, (_, f) => [
    sq(0x0020, 0x9113, [[str(0x0020, 0x0032, 'DS', ipp(frames - 1 - f))]]),
  ]);
  return part10(ENHANCED_CT, o.sopUid ?? '2.25.1001.1', [
    str(0x0008, 0x0020, 'DA', '20240102'),
    str(0x0008, 0x0060, 'CS', 'CT'),
    str(0x0020, 0x000e, 'UI', '2.25.1001'),
    str(0x0028, 0x0008, 'IS', o.framesTag ?? String(frames)),
    ...imageTags({ rows, cols, signed: false, intercept: -1024 }),
    sq(0x5200, 0x9229, [
      [
        sq(0x0028, 0x9110, [
          [
            str(0x0028, 0x0030, 'DS', `${SPACING[0]}\\${SPACING[1]}`),
            str(0x0018, 0x0050, 'DS', String(SPACING[2])),
            str(0x0018, 0x0088, 'DS', String(SPACING[2])),
          ],
        ]),
      ],
    ]),
    sq(0x5200, 0x9230, perFrame),
    ob(0x7fe0, 0x0010, pixels, 'OW'),
  ]);
}

/** One classic-CT slice file of the sample (slice index c); `sopUid` '' writes a blank UID. */
export function sliceBytes(c: number, series: string, signed: boolean, sopUid?: string): Uint8Array {
  return part10(CT_IMAGE, sopUid ?? `${series}.${c + 1}`, [
    str(0x0008, 0x0020, 'DA', '20230405'),
    str(0x0008, 0x0060, 'CS', 'CT'),
    str(0x0018, 0x0050, 'DS', String(SPACING[2])),
    str(0x0018, 0x0088, 'DS', String(SPACING[2])),
    str(0x0020, 0x000e, 'UI', series),
    str(0x0020, 0x0032, 'DS', ipp(c)),
    str(0x0020, 0x0037, 'DS', '1\\0\\0\\0\\1\\0'),
    str(0x0028, 0x0030, 'DS', `${SPACING[0]}\\${SPACING[1]}`),
    ...imageTags({ rows: N, cols: N, signed, intercept: signed ? 0 : -1024 }),
    ob(0x7fe0, 0x0010, slicePixels(c, signed), 'OW'),
  ]);
}

/** the first slice index of the 40-slice series and tree */
export const SERIES_FIRST = 12;
export const SERIES_COUNT = 40;

export const XRAY_ROWS = 64;
export const XRAY_COLS = 80;
/** raw stored value of the radiograph pixel (r, c): a gradient, unique max at the far corner */
export const xrayRaw = (r: number, c: number) => 100 + c * 40 + r * 3;

/** A single-frame PX radiograph, MONOCHROME1, 64 rows x 80 columns. */
export function radiographBytes(): Uint8Array<ArrayBuffer> {
  const px = new Uint8Array(XRAY_ROWS * XRAY_COLS * 2);
  const dv = new DataView(px.buffer);
  for (let r = 0; r < XRAY_ROWS; r++)
    for (let c = 0; c < XRAY_COLS; c++) dv.setUint16((r * XRAY_COLS + c) * 2, xrayRaw(r, c), true);
  return part10(DX_PRESENTATION, '2.25.4001.1', [
    str(0x0008, 0x0020, 'DA', '20220607'),
    str(0x0008, 0x0060, 'CS', 'PX'),
    str(0x0018, 0x1164, 'DS', '0.1\\0.1'),
    str(0x0020, 0x000e, 'UI', '2.25.4001'),
    ...imageTags({ rows: XRAY_ROWS, cols: XRAY_COLS, signed: false, intercept: 0, photometric: 'MONOCHROME1' }),
    ob(0x7fe0, 0x0010, px, 'OW'),
  ]);
}

/** A DICOMDIR-shaped index: a DICM file with no image (the scanner must skip it). */
function dicomdirBytes(): Uint8Array {
  return part10('1.2.840.10008.1.3.10', '2.25.3000.1', [str(0x0004, 0x1130, 'CS', 'FIXTURE')]);
}

// ---------------------------------------------------------------------------
// writing into a temp tree

export function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cbctscope-fixture-'));
}

export function removeTempDir(dir: string): void {
  if (!dir.startsWith(os.tmpdir())) throw new Error('refusing to remove a directory outside the temp folder');
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeAt(root: string, rel: string, bytes: Uint8Array | string): string {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, bytes);
  return rel;
}

/** a deterministic shuffle so file order never equals z order */
const shuffled = (n: number) => Array.from({ length: n }, (_, i) => (i * 17 + 5) % n);

/** Writes the four shapes under `root`; returns each shape's folder and its relative file paths. */
export function writeFixtures(root: string) {
  const mf = [writeAt(root, 'mf/volume.dcm', multiframeBytes())];

  const series = shuffled(SERIES_COUNT).map((c, i) =>
    writeAt(root, `series/IM_${String(i).padStart(4, '0')}.dcm`, sliceBytes(SERIES_FIRST + c, '2.25.2001', false)),
  );

  // DICOMDIR tree: index at the root, extensionless images split across a nested folder, junk beside
  const tree = [
    writeAt(root, 'tree/DICOMDIR', dicomdirBytes()),
    writeAt(root, 'tree/README.TXT', 'synthetic fixture tree\n'),
    ...shuffled(SERIES_COUNT).map((c, i) => {
      const dir = i < SERIES_COUNT / 2 ? 'tree/DATA/S1' : 'tree/DATA/S2/DEEP';
      return writeAt(root, `${dir}/IM${String(i).padStart(6, '0')}`, sliceBytes(SERIES_FIRST + c, '2.25.3001', true));
    }),
  ];

  const xray = [writeAt(root, 'xray/pano.dcm', radiographBytes())];
  const junk = [writeAt(root, 'junk/notes.txt', 'not imaging\n'), writeAt(root, 'junk/photo.dcm', 'x'.repeat(400))];

  return { mf, series, tree, xray, junk };
}
