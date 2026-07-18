// Browser-only Cornerstone3D 4.x lifecycle helper. Imported only by CbctViewport (which is
// dynamically imported with ssr:false), so none of this runs on the server.
import { init as coreInit } from '@cornerstonejs/core';
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';
import { init as toolsInit } from '@cornerstonejs/tools';

let initPromise: Promise<void> | null = null;

/** Idempotent: initialises core + dicom loader + tools exactly once. */
export function ensureCornerstoneInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await coreInit();
      await dicomImageLoaderInit();
      await toolsInit();
    })();
  }
  return initPromise;
}
