// PLACEHOLDER. The loader track replaces this file with the real browser source
// (docs/web-build.md, section 5). It exists so the shell track typechecks against the seam.
import type { VolumeSource } from './volumeSource';

const notReady = () => Promise.reject(new Error('browserSource is not implemented yet'));

export const browserSource: VolumeSource = {
  list: notReady,
  meta: notReady,
  data: notReady,
  opened: notReady,
  open: notReady,
  close: notReady,
  registerFused: notReady,
  getEvidence: notReady,
  putEvidence: notReady,
};
