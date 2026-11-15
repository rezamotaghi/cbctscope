// The one volume source the viewer talks to, chosen once at module level by the build target
// (docs/web-build.md, sections 3 and 4). NEXT_PUBLIC_ variables are inlined at build time, and
// the condition reads the variable itself (not a re-export) so the bundler sees a constant: in
// the local app the dynamic import of the browser loader sits in a dead branch and the loader,
// its scanner and its assembly worker are dropped from the bundle; in the web build the loader
// is fetched on first use.
import type { OpenResult, VolumeSource } from '@/lib/browser/volumeSource';
import { serverSource } from './serverSource';
import { IS_WEB } from './shell';

export { IS_WEB };

/** a source behind a lazy loader: no top-level side effect */
function lazySource(load: () => Promise<VolumeSource>): VolumeSource {
  let loaded: Promise<VolumeSource> | null = null;
  const get = () => (loaded ??= load());
  return {
    list: async () => (await get()).list(),
    meta: async (anon) => (await get()).meta(anon),
    data: async (anon, onProgress) => (await get()).data(anon, onProgress),
    opened: async () => (await get()).opened(),
    open: async (input, onProgress) => (await get()).open(input, onProgress),
    close: async () => (await get()).close(),
    registerFused: async (meta, voxels) => (await get()).registerFused(meta, voxels),
    getEvidence: async (anon) => (await get()).getEvidence(anon),
    putEvidence: async (file) => (await get()).putEvidence(file),
  };
}

// the import() must sit in the branch itself: the bundler skips a dead branch's dynamic import,
// but not one inside a function it merely never calls
export const source: VolumeSource =
  process.env.NEXT_PUBLIC_CBCTSCOPE_TARGET === 'web'
    ? lazySource(() => import('@/lib/browser/browserSource').then((m) => m.browserSource))
    : serverSource;

/** an open the reader dismissed (the native chooser's cancel): not an error, show nothing */
export const isCanceled = (r: OpenResult): boolean => !r.ok && r.error === '';
