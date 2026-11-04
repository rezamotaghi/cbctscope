// BROWSER, module Web Worker. Runs assemble() off the UI thread and transfers the voxel buffer
// back (no copy). Created by browserSource.ts with
//   new Worker(new URL('./assemble.worker.ts', import.meta.url), { type: 'module' })
// which Next's webpack bundles as its own chunk.
//
// Protocol (one worker, many jobs, keyed by id):
//   in:  { id, job: AssembleJob }
//   out: { id, type: 'progress', fraction } | { id, type: 'done', meta, voxels } | { id, type: 'error', message }
import { assemble, type AssembleJob } from './assemble';

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
  let last = -1;
  assemble(job, (fraction) => {
    // throttle to whole percents so a big series does not flood the channel
    const pct = Math.floor(fraction * 100);
    if (pct === last) return;
    last = pct;
    scope.postMessage({ id, type: 'progress', fraction });
  }).then(
    ({ meta, voxels }) => scope.postMessage({ id, type: 'done', meta, voxels }, [voxels.buffer]),
    (err: unknown) =>
      scope.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : 'assembly failed' }),
  );
};
