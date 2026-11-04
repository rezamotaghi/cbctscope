// SERVER-ONLY. The shared DICOM helpers and contract types live in lib/shared/dicom.ts (no
// Node API, so the browser loader uses them too); this module re-exports them and adds the
// server's Buffer-carrying assembled volume.
export * from '../shared/dicom';
import type { CbctVolumeMeta } from '../shared/dicom';

export interface AssembledVolume {
  meta: CbctVolumeMeta;
  /** Int16 LE HU voxels, x-fastest, y, z-ascending */
  data: Buffer;
}
