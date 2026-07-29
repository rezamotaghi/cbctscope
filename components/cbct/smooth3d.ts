'use client';
// Denoised substrate for the 3D render pane.
//
// CBCT projection noise is what makes a shaded volume render look "dirty" even with good
// lighting: every voxel jitters, so the extracted surface stipples. Commercial viewers
// render their 3D view from a lightly smoothed copy of the volume while the slice views
// keep the original. This module builds that copy: one separable 5-tap binomial blur
// ([1,4,6,4,1]/16 along x, then y, then z ≈ a Gaussian with σ≈1 voxel), run in a Web
// Worker so the UI never blocks, cached per volume (a volume pair stays warm, mirroring
// volumeData's 2-entry cache). MPR slices never read this buffer — diagnostic sharpness
// is untouched; the 3D pane is a presentation surface.
//
// The worker is built from a Blob URL (kernel function stringified) instead of a bundled
// worker file — bundler-agnostic, so webpack/turbopack dev/build all behave identically.

import type { VolumeEntry } from './volumeData';

// ---- worker kernel (self-contained: no imports, no closure captures — it is stringified)
function smoothKernel() {
  self.onmessage = (e: MessageEvent<{ dims: [number, number, number]; buf: ArrayBuffer }>) => {
    const [nx, ny, nz] = e.data.dims;
    let src = new Int16Array(e.data.buf);
    let dst = new Int16Array(src.length);
    // one pass of [1,4,6,4,1]/16 along `axis`, edge-clamped, integer math (rounds via +8)
    const pass = (stride: number, n: number, oStride: number, oN: number, iStride: number, iN: number) => {
      for (let o = 0; o < oN; o++) {
        for (let i = 0; i < iN; i++) {
          const rowBase = o * oStride + i * iStride;
          for (let k = 0; k < n; k++) {
            const km2 = k > 1 ? k - 2 : 0;
            const km1 = k > 0 ? k - 1 : 0;
            const kp1 = k < n - 1 ? k + 1 : n - 1;
            const kp2 = k < n - 2 ? k + 2 : n - 1;
            dst[rowBase + k * stride] =
              (src[rowBase + km2 * stride] +
                4 * src[rowBase + km1 * stride] +
                6 * src[rowBase + k * stride] +
                4 * src[rowBase + kp1 * stride] +
                src[rowBase + kp2 * stride] +
                8) >>
              4;
          }
        }
        // yield nothing — worker thread, blocking is fine
      }
      const t = src;
      src = dst;
      dst = t;
    };
    // x pass: stride 1, rows are (y,z); y pass: stride nx; z pass: stride nx*ny
    pass(1, nx, nx, ny * nz, 0, 1);
    pass(nx, ny, nx * ny, nz, 1, nx);
    pass(nx * ny, nz, 1, nx * ny, 0, 1);
    // after 3 passes the result sits in `src` (swapped each pass)
    (self as unknown as { postMessage: (m: unknown, t: Transferable[]) => void }).postMessage(
      { buf: src.buffer },
      [src.buffer],
    );
  };
}

const cache = new Map<string, Int16Array>();
const inflight = new Map<string, Promise<Int16Array>>();

/** Synchronous cache peek — lets call sites pick a substrate without awaiting. */
export function getCachedSmooth3d(anon: string): Int16Array | undefined {
  return cache.get(anon);
}

/** Build (or fetch) the denoised copy of a volume's voxels. Never throws into the render
 *  path — callers treat a rejection as "keep the original substrate". */
export function getSmooth3d(anon: string, entry: VolumeEntry): Promise<Int16Array> {
  const hit = cache.get(anon);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(anon);
  if (pending) return pending;
  const p = new Promise<Int16Array>((resolve, reject) => {
    let worker: Worker;
    let url = '';
    try {
      url = URL.createObjectURL(
        new Blob([`(${smoothKernel.toString()})()`], { type: 'application/javascript' }),
      );
      worker = new Worker(url);
    } catch (err) {
      if (url) URL.revokeObjectURL(url);
      reject(err);
      return;
    }
    const done = (fn: () => void) => {
      worker.terminate();
      URL.revokeObjectURL(url);
      fn();
    };
    worker.onmessage = (e: MessageEvent<{ buf: ArrayBuffer }>) =>
      done(() => {
        const out = new Int16Array(e.data.buf);
        cache.set(anon, out);
        while (cache.size > 2) cache.delete(cache.keys().next().value as string);
        resolve(out);
      });
    worker.onerror = (e) => done(() => reject(e));
    // copy: the live volume's buffer must stay untouched (the worker transfer would detach it)
    const copy = new Int16Array(entry.scalar);
    worker.postMessage({ dims: entry.meta.dims, buf: copy.buffer }, [copy.buffer]);
  });
  inflight.set(anon, p);
  p.finally(() => inflight.delete(anon)).catch(() => {});
  return p;
}
