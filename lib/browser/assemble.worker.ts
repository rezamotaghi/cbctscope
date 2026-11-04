// BROWSER, module Web Worker. Runs assemble() off the UI thread and transfers the voxel buffer
// back (no copy). Created by browserSource.ts with
//   new Worker(new URL('./assemble.worker.ts', import.meta.url), { type: 'module' })
// which Next's webpack bundles as its own chunk.
//
// Protocol (one worker, many jobs, keyed by id):
//   in:  { id, job: AssembleJob }
//   out: { id, type: 'progress', fraction } | { id, type: 'done', meta, voxels } | { id, type: 'error', message }
import { assemble, type AssembleJob } from './assemble';
import { createProgressGate } from './progress';

export type WorkerRequest = { id: number; job: AssembleJob };
export type WorkerReply =
  | { id: number; type: 'progress'; fraction: number }
  | { id: number; type: 'done'; meta: import('../shared/dicom').CbctVolumeMeta; voxels: Int16Array }
  | { id: number; type: 'error'; message: string };

interface WorkerScope {
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { id, job } = e.data;
  // at least every 2 % or 100 ms, whichever comes first, so a big series neither floods the
  // channel nor goes quiet on a slow disk
  const gate = createProgressGate(0.02, 100);
  assemble(job, (fraction) => {
    if (!gate(fraction, performance.now())) return;
    scope.postMessage({ id, type: 'progress', fraction });
  }).then(
    ({ meta, voxels }) => scope.postMessage({ id, type: 'done', meta, voxels }, [voxels.buffer]),
    (err: unknown) =>
      scope.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : 'assembly failed' }),
  );
};
