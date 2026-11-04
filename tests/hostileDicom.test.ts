// Hostile and ambiguous DICOM, on both loaders: geometry a header cannot be trusted with
// (fractional frames, pixel data shorter or far longer than promised), exports without UIDs
// whose ids must not collide, exact duplicates, and the cheap metadata path. Synthetic files
// from tests/fixtures/dicomWriter.ts, in a temp folder only.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserSource, directRunner, type AssemblyRunner } from '../lib/browser/browserSource';
import { readPixelRange } from '../lib/browser/assemble';
import { HEAD_BYTES, volumeId } from '../lib/browser/scan';
import { assertPixelRange, positiveIntTag } from '../lib/shared/dicomScan';
import { sha256, sha256Hex } from '../lib/shared/sha256';
import { N, makeTempDir, multiframeBytes, removeTempDir, sliceBytes } from './fixtures/dicomWriter';

let tmp = '';
beforeEach(() => {
  tmp = makeTempDir();
});
afterEach(() => removeTempDir(tmp));

const memory = () => {
  const map = new Map<string, unknown>();
  return { get: async (k: string) => map.get(k), put: async (k: string, v: unknown) => void map.set(k, v) };
};
const source = (runner: AssemblyRunner = directRunner) => createBrowserSource({ runner, evidence: memory() });

function file(bytes: Uint8Array, rel: string): File {
  const f = new File([bytes as Uint8Array<ArrayBuffer>], path.basename(rel));
  Object.defineProperty(f, 'webkitRelativePath', { value: rel });
  return f;
}

/** a 30-slice CT series with blank SeriesInstanceUID and blank SOP Instance UIDs */
function uidlessSeries(folder: string, firstSlice: number): File[] {
  return Array.from({ length: 30 }, (_, i) => file(sliceBytes(firstSlice + i, '', false, ''), `${folder}/IM${i}.dcm`));
}

describe('shared geometry checks', () => {
  it('NumberOfFrames must be a positive whole number', () => {
    expect(positiveIntTag(undefined)).toBe(1);
    expect(positiveIntTag('64')).toBe(64);
    expect(positiveIntTag(' 64 ')).toBe(64);
    for (const bad of ['16.5', '0', '-3', 'abc', '1e3', '99999999999999999999']) expect(positiveIntTag(bad)).toBeNull();
  });

  it('a promised range past the end of the bytes is refused in plain words', () => {
    expect(() => assertPixelRange(100, 50, 150)).not.toThrow();
    expect(() => assertPixelRange(100, 51, 150)).toThrow(/truncated/);
  });
});

describe('browser loader', () => {
  it('refuses a multiframe file whose NumberOfFrames is "16.5"', async () => {
    const res = await source().open({ kind: 'files', files: [file(multiframeBytes({ framesTag: '16.5' }), 'mf/v.dcm')] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasons).toEqual(['Rows, Columns or NumberOfFrames not a positive whole number: 1 file']);
  });

  it('reads only the promised pixel range of a file padded far beyond its pixel data', async () => {
    const real = multiframeBytes();
    const padded = new Uint8Array(real.length + 64 * 1024 * 1024);
    padded.set(real);
    const f = file(padded, 'mf/padded.dcm');
    const sliceSpy = vi.spyOn(f, 'slice');
    const { px } = await readPixelRange(f, () => N * N * N * 2);
    expect(px.byteLength).toBe(N * N * N * 2);
    // every read is a bounded slice (the header's first megabytes, then the pixel range); none
    // reads the whole padded file
    expect(sliceSpy.mock.calls.length).toBeGreaterThan(0);
    for (const call of sliceSpy.mock.calls) {
      expect(call[1]).toBeDefined();
      expect(Number(call[1]) - Number(call[0] ?? 0)).toBeLessThanOrEqual(Math.max(HEAD_BYTES, N * N * N * 2));
      expect(Number(call[1])).toBeLessThan(padded.length);
    }
    const src = source();
    expect((await src.open({ kind: 'files', files: [f] })).ok).toBe(true);
    const [v] = await src.list();
    expect((await src.data(v.anon)).length).toBe(N * N * N);
  });

  it('refuses a file shorter than the range its header promises', async () => {
    const short = file(multiframeBytes({ pixelBytes: new Uint8Array(1000) }), 'mf/short.dcm');
    const src = source();
    expect((await src.open({ kind: 'files', files: [short] })).ok).toBe(true);
    const [v] = await src.list();
    await expect(src.data(v.anon)).rejects.toThrow(/truncated/);
  });

  it('two UID-less exports get distinct ids, and a duplicated file gives one row', async () => {
    // same folder name, same file names, same sizes, other slices: the old key (dir:<rel>) collided
    const sa = source();
    await sa.open({ kind: 'files', files: uidlessSeries('caseA', 0) });
    const sb = source();
    await sb.open({ kind: 'files', files: uidlessSeries('caseA', 20) });
    const [ida] = await sa.list();
    const [idb] = await sb.list();
    expect(ida.anon).not.toBe(idb.anon);

    // the multiframe file twice in one export (same SOP UID, same size): one catalog row
    const mf = multiframeBytes();
    const dup = source();
    expect(await dup.open({ kind: 'files', files: [file(mf, 'x/a.dcm'), file(mf, 'x/copy/a.dcm')] })).toEqual({ ok: true, label: 'x', count: 1 });
  });

  it('volume ids keep their pre-existing value and need no crypto.subtle', async () => {
    const before = createHash('sha256').update('2.25.1001.1\u00001').digest('hex').slice(0, 12);
    vi.stubGlobal('crypto', { ...globalThis.crypto, subtle: undefined });
    try {
      expect(await volumeId('2.25.1001.1', 1)).toBe(`local_${before}`);
    } finally {
      vi.unstubAllGlobals();
    }
    for (const text of ['', 'abc', 'x'.repeat(1000)]) {
      expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'));
    }
    expect(sha256(new Uint8Array(64)).length).toBe(32);
  });

  it('meta() answers without assembling; data() assembles and reports progress', async () => {
    const runner = vi.fn<AssemblyRunner>((job, onProgress) => directRunner(job, onProgress));
    const src = source(runner);
    await src.open({ kind: 'files', files: [file(multiframeBytes(), 'mf/v.dcm')] });
    const [v] = await src.list();
    const meta = await src.meta(v.anon);
    expect(runner).not.toHaveBeenCalled();
    const fractions: number[] = [];
    const voxels = await src.data(v.anon, (f) => fractions.push(f));
    expect(runner).toHaveBeenCalledTimes(1);
    expect(fractions.length).toBeGreaterThan(1);
    expect(fractions.at(-1)).toBe(1);
    // the cheap meta equals what the assembly computes
    const assembled = await directRunner({ kind: 'volume', volume: (await getVolume(src, v.anon))! });
    expect(meta).toEqual(assembled.meta);
    expect(voxels.length).toBe(N * N * N);
    // nothing is kept resident: a second data() assembles again (volumeData.ts is the cache)
    await src.data(v.anon);
    expect(runner).toHaveBeenCalledTimes(2);
  });
});

/** the scanned volume behind an id, through a fresh scan of the same file (test helper) */
async function getVolume(_src: unknown, anon: string) {
  const { scanFiles } = await import('../lib/browser/scan');
  const r = await scanFiles([file(multiframeBytes(), 'mf/v.dcm')]);
  return r.ok ? r.volumes.find((x) => x.id === anon) : undefined;
}

describe('server loader', () => {
  it('refuses fractional frames and a truncated multiframe instead of reading out of range', async () => {
    process.env.CBCTSCOPE_DEMO = '1'; // no source pointer written to the app-data folder
    vi.resetModules();
    const { setLocalSource, getAssembledLocalVolume, listLocalVolumes, clearLocalSource } = await import('../lib/server/localSource');
    const dir = path.join(tmp, 'srv');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'frac.dcm'), multiframeBytes({ framesTag: '16.5', sopUid: '2.25.9.1' }));
    expect(setLocalSource(dir).ok).toBe(false);
    fs.rmSync(path.join(dir, 'frac.dcm'));
    fs.writeFileSync(path.join(dir, 'short.dcm'), multiframeBytes({ pixelBytes: new Uint8Array(1000) }));
    expect(setLocalSource(dir).ok).toBe(true);
    const [v] = listLocalVolumes();
    expect(() => getAssembledLocalVolume(v.anon)).toThrow(/truncated/);
    clearLocalSource();
  });
});
