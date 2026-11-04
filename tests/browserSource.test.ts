// The browser loader (lib/browser/) against synthetic DICOM written from the phantom into a
// per-test temp folder (tests/fixtures/dicomWriter.ts). Node environment: File and
// crypto.subtle are Node globals; there is no Worker here, so assembly runs through the
// direct runner, the same assemble() the worker calls; IndexedDB is replaced by an adapter.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBrowserSource, directRunner } from '../lib/browser/browserSource';
import { createEvidenceStore, type KeyValueAdapter } from '../lib/browser/evidenceStore';
import { MAX_WALK_FILES } from '../lib/browser/scan';
import type { OpenProgress } from '../lib/browser/volumeSource';
import { VOLUME_ID_RE } from '../lib/shared/dicom';
import { XRAY_MAX } from '../lib/shared/radiograph';
import { getPhantomVolume, PHANTOM_ID } from '../lib/server/phantom';
import { EVIDENCE_SCHEMA, type EvidenceFile } from '../components/cbct/evidence';
import {
  N,
  ORIGIN,
  SERIES_COUNT,
  SERIES_FIRST,
  SPACING,
  XRAY_COLS,
  XRAY_ROWS,
  makeTempDir,
  multiframeBytes,
  phantomSample,
  radiographBytes,
  removeTempDir,
  writeFixtures,
  xrayRaw,
} from './fixtures/dicomWriter';

let tmp = '';
let fx: ReturnType<typeof writeFixtures>;

beforeEach(() => {
  tmp = makeTempDir();
  fx = writeFixtures(tmp);
});
afterEach(() => removeTempDir(tmp));

/** File objects as a directory pick delivers them: webkitRelativePath "<folder>/<rel>" */
function pick(rels: string[], prefix = ''): File[] {
  return rels.map((rel) => {
    const f = new File([fs.readFileSync(path.join(tmp, rel))], path.basename(rel));
    Object.defineProperty(f, 'webkitRelativePath', { value: prefix + rel });
    return f;
  });
}

const source = () => createBrowserSource({ runner: directRunner, evidence: memoryAdapter() });

function memoryAdapter(): KeyValueAdapter & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return { map, get: async (k) => map.get(k), put: async (k, v) => void map.set(k, v) };
}

/** HU slices [from, from + count) of the 64^3 phantom sample */
const sampleSlices = (from: number, count: number) => phantomSample().slice(from * N * N, (from + count) * N * N);

describe('browserSource: the four export shapes', () => {
  const shapes = [
    { name: 'multiframe', rels: () => fx.mf, kind: 'mf', z: N, first: 0, label: 'volume' },
    { name: 'slice-per-file series', rels: () => fx.series, kind: 'slices', z: SERIES_COUNT, first: SERIES_FIRST, label: 'series' },
    { name: 'DICOMDIR tree, extensionless, nested', rels: () => fx.tree, kind: 'slices', z: SERIES_COUNT, first: SERIES_FIRST, label: 'S2/DEEP' },
  ] as const;

  for (const s of shapes) {
    it(`${s.name}: opens, lists, and assembles the phantom voxels`, async () => {
      const src = source();
      const res = await src.open({ kind: 'files', files: pick(s.rels()) });
      expect(res).toEqual({ ok: true, label: s.rels()[0].split('/')[0], count: 1 });

      const list = await src.list();
      expect(list).toHaveLength(2);
      expect(list[1].anon).toBe(PHANTOM_ID);
      const v = list[0];
      expect(v.anon).toMatch(VOLUME_ID_RE);
      expect(v.anon.startsWith('local_')).toBe(true);
      expect(v.kind).toBe(s.kind);
      expect(v.dims).toEqual([N, N, s.z]);
      v.spacing.forEach((sp, i) => expect(sp).toBeCloseTo(SPACING[i], 9)); // z is a median of DS deltas
      expect(v.label).toBe(s.label);

      // a second open of fresh File objects (a reopen) keeps the id, so the sidecar survives
      const again = source();
      await again.open({ kind: 'files', files: pick(s.rels()) });
      expect((await again.list())[0].anon).toBe(v.anon);

      const meta = await src.meta(v.anon);
      expect(meta.dims).toEqual([N, N, s.z]);
      expect(meta.origin).toEqual([ORIGIN[0], ORIGIN[1], +(ORIGIN[2] + s.first * SPACING[2]).toFixed(3)]);
      expect(meta.bytes).toBe(N * N * s.z * 2);

      const vox = await src.data(v.anon);
      expect(vox).toBeInstanceOf(Int16Array);
      expect(vox.length).toBe(N * N * s.z);
      const expected = sampleSlices(s.first, s.z);
      const centre = Math.floor(s.z / 2) * N * N + (N / 2) * N + N / 2;
      expect(vox[centre]).toBe(expected[centre]);
      expect(Buffer.from(vox.buffer, vox.byteOffset, vox.byteLength).equals(Buffer.from(expected.buffer))).toBe(true);
    });
  }

  it('the radiograph comes back on the 0..4095 scale with MONOCHROME1 flipped', async () => {
    const src = source();
    const res = await src.open({ kind: 'files', files: pick(fx.xray) });
    expect(res.ok).toBe(true);
    const [v] = await src.list();
    expect(v.kind).toBe('xray');
    expect(v.dims).toEqual([XRAY_COLS, XRAY_ROWS, 1]);
    expect(v.spacing).toEqual([0.1, 0.1, 1]);
    const vox = await src.data(v.anon);
    expect(vox.length).toBe(XRAY_COLS * XRAY_ROWS);
    // raw minimum at (0, 0) is white after the flip, raw maximum at the far corner is black
    expect(vox[0]).toBe(XRAY_MAX);
    expect(vox[vox.length - 1]).toBe(0);
    const lo = xrayRaw(0, 0);
    const hi = xrayRaw(XRAY_ROWS - 1, XRAY_COLS - 1);
    const r = 10;
    const c = 20;
    expect(vox[r * XRAY_COLS + c]).toBe(XRAY_MAX - Math.round(((xrayRaw(r, c) - lo) * XRAY_MAX) / (hi - lo)));
    expect(Math.min(...vox)).toBe(0);
    expect(Math.max(...vox)).toBe(XRAY_MAX);
  });

  it('one loose file (no relative path) opens under its own name', async () => {
    const src = source();
    const f = new File([radiographBytes()], 'pano.dcm');
    expect(await src.open({ kind: 'files', files: [f] })).toEqual({ ok: true, label: 'pano.dcm', count: 1 });
    expect((await src.list())[0].label).toBe('pano');
    expect(await src.opened()).toEqual({ label: 'pano.dcm', count: 1 });
  });

  it('a whole tree of shapes lists every volume, sorted by label', async () => {
    const src = source();
    const all = [...fx.mf, ...fx.series, ...fx.tree, ...fx.xray, ...fx.junk];
    const res = await src.open({ kind: 'files', files: pick(all, 'root/') });
    expect(res).toEqual({ ok: true, label: 'root', count: 4 });
    expect((await src.list()).map((e) => e.label)).toEqual([
      'mf/volume',
      'S2/DEEP',
      'series',
      'xray/pano',
      'Synthetic phantom (demo)',
    ]);
  });
});

describe('browserSource: open progress', () => {
  it('reports the scan, then the first assembly, then the display phase', async () => {
    const src = source();
    const seen: OpenProgress[] = [];
    const res = await src.open({ kind: 'files', files: pick(fx.series) }, (p) => seen.push(p));
    expect(res.ok).toBe(true);
    const scans = seen.filter((p) => p.phase === 'scan');
    expect(scans[0]).toEqual({ phase: 'scan', done: 0, total: SERIES_COUNT });
    expect(scans.at(-1)).toEqual({ phase: 'scan', done: SERIES_COUNT, total: SERIES_COUNT });
    expect(seen.some((p) => p.phase !== 'scan')).toBe(false); // nothing assembles before it is asked

    // meta() starts the assembly without a listener; data() joins it and still hears it
    const id = (await src.list())[0].anon;
    const fractions: number[] = [];
    const [, voxels] = await Promise.all([src.meta(id), src.data(id, (f) => fractions.push(f))]);
    expect(voxels.length).toBe(N * N * SERIES_COUNT);
    expect(fractions.at(-1)).toBe(1);
    const after = seen.slice(scans.length);
    expect(after[0]).toEqual({ phase: 'assemble', done: 0, total: 100 });
    expect(after.at(-2)).toEqual({ phase: 'assemble', done: 100, total: 100 });
    expect(after.at(-1)).toEqual({ phase: 'display', done: 0 });

    // one-shot: a second assembly (after a reopen) is not the first open's
    const n = seen.length;
    await src.open({ kind: 'files', files: pick(fx.mf) });
    await src.data((await src.list())[0].anon);
    expect(seen.length).toBe(n);
  });
});

describe('browserSource: refusals and guards', () => {
  it('a folder of non-DICOM files is refused with a clear error', async () => {
    const src = source();
    expect(await src.open({ kind: 'files', files: pick(fx.junk) })).toEqual({
      ok: false,
      error: 'No DICOM volume found in 2 files',
      scanned: 2,
      reasons: ['no DICM magic bytes, not DICOM: 2 files'],
    });
    expect(await src.opened()).toBeNull();
  });

  it('the native chooser is refused in the browser', async () => {
    expect(await source().open({ kind: 'native', chooser: 'folder' })).toEqual({
      ok: false,
      error: 'native chooser is not available in the browser',
    });
  });

  it(`stops after ${MAX_WALK_FILES} files, as the server walk does`, async () => {
    const junk = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const f = new File(['x'], `j${i}`);
        Object.defineProperty(f, 'webkitRelativePath', { value: `big/j${i}` });
        return f;
      });
    const xray = new File([radiographBytes()], 'pano.dcm');
    Object.defineProperty(xray, 'webkitRelativePath', { value: 'big/pano.dcm' });

    const over = await source().open({ kind: 'files', files: [...junk(MAX_WALK_FILES), xray] });
    expect(over).toMatchObject({ ok: false, error: `No DICOM volume found in 8,000 files`, scanned: MAX_WALK_FILES });
    if (!over.ok) expect(over.reasons?.at(-1)).toBe('the scan stops at 8,000 files: open the export folder itself');
    const under = await source().open({ kind: 'files', files: [...junk(MAX_WALK_FILES - 1), xray] });
    expect(under.ok).toBe(true);
  });

  it('skips a volume over the 1.5 GB guard without allocating it', async () => {
    // a header claiming 4096 x 4096 x 50 frames (1.68 GB of voxels) over 2 bytes of pixel data
    const big = new File([multiframeBytes({ rows: 4096, cols: 4096, frames: 50, pixelBytes: new Uint8Array(2) })], 'big.dcm');
    const res = await source().open({ kind: 'files', files: [big] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons).toEqual(['over the 1.5 GB size guard: 1 volume']);
  });

  it('a failed open keeps the previous source; close clears it', async () => {
    const src = source();
    await src.open({ kind: 'files', files: pick(fx.mf) });
    await src.open({ kind: 'files', files: pick(fx.junk) });
    expect(await src.opened()).toEqual({ label: 'mf', count: 1 });
    await src.close();
    expect(await src.opened()).toBeNull();
    expect((await src.list()).map((e) => e.anon)).toEqual([PHANTOM_ID]);
  });
});

describe('browserSource: phantom, fused, evidence', () => {
  it('lists the phantom with the server route label and geometry, and generates it once', async () => {
    const src = source();
    const [row] = await src.list();
    const server = getPhantomVolume().meta;
    expect(row).toEqual({
      anon: server.anon,
      kind: server.kind,
      dims: server.dims,
      spacing: server.spacing,
      fov: server.fov,
      region: server.region,
      year: server.year,
      pair: null,
      label: 'Synthetic phantom (demo)',
    });
    const meta = await src.meta(PHANTOM_ID);
    expect(meta).toEqual(server);
    const a = await src.data(PHANTOM_ID);
    expect(await src.data(PHANTOM_ID)).toBe(a);
    expect(Buffer.from(a.buffer).equals(getPhantomVolume().data)).toBe(true);
  });

  it('registers fused volumes in memory, listed first and newest first', async () => {
    const src = source();
    await src.open({ kind: 'files', files: pick(fx.xray) });
    const geo = {
      dims: [4, 4, 4] as [number, number, number],
      spacing: [1, 1, 1] as [number, number, number],
      origin: [0, 0, 0] as [number, number, number],
      defaultVoi: { center: 0, width: 100 },
      year: '2024',
    };
    const a = await src.registerFused({ ...geo, label: 'A' }, new Int16Array(64).fill(1));
    const b = await src.registerFused({ ...geo, label: 'B' }, new Int16Array(64).fill(2));
    expect(a.anon).toMatch(/^fused_[0-9a-f]{12}$/);
    const list = await src.list();
    expect(list.map((e) => e.label)).toEqual(['B', 'A', 'pano', 'Synthetic phantom (demo)']);
    expect((await src.data(b.anon))[0]).toBe(2);
    expect((await src.meta(a.anon)).region).toBe('fused');
  });

  it('round-trips the evidence JSON unchanged and degrades when storage fails', async () => {
    const mem = memoryAdapter();
    const src = createBrowserSource({ runner: directRunner, evidence: mem });
    const file: EvidenceFile = {
      schema: EVIDENCE_SCHEMA,
      anon: 'local_0123456789ab',
      saved_at: '2026-11-04T00:00:00.000Z',
      annotations: [{ data: { handles: { points: [[1, 2, 3]] } } }],
      views: [],
      rois3d: [],
      traces: [],
    };
    expect(await src.getEvidence(file.anon)).toBeNull();
    expect(await src.putEvidence(file)).toBe(true);
    expect(mem.map.get(file.anon)).toEqual(file);
    expect(await src.getEvidence(file.anon)).toEqual(file);
    expect(await src.putEvidence({ ...file, anon: '../escape' })).toBe(false);

    const broken = createEvidenceStore({
      get: () => Promise.reject(new Error('blocked')),
      put: () => Promise.reject(new Error('blocked')),
    });
    expect(await broken.get(file.anon)).toBeNull();
    expect(await broken.put(file)).toBe(false);

    // the default IndexedDB adapter with no IndexedDB at all (Node) reads as "no sidecar"
    const bare = createEvidenceStore();
    expect(await bare.get(file.anon)).toBeNull();
    expect(await bare.put(file)).toBe(false);
  });
});
