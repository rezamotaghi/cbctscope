// SERVER-ONLY. Filesystem locations. Imported only by API routes.
//
// Privacy stance: the viewer opens local CBCT exports in place and never copies, uploads, or
// re-serves them anywhere. The only thing written to disk is this app-data folder, which holds
// (a) the remembered "open" source pointer and (b) per-volume annotation sidecars — display
// labels, world-mm geometry, and HU statistics only, never pixel data.
import os from 'node:os';
import path from 'node:path';

/** App-data folder (override with CBCTSCOPE_DATA). */
export const DATA_DIR = process.env.CBCTSCOPE_DATA
  ? path.resolve(process.env.CBCTSCOPE_DATA)
  : path.join(os.homedir(), '.cbctscope');

/**
 * Demo mode (`npm run demo` / CBCTSCOPE_DEMO=1): never restore or persist an opened
 * source, so a demo session can only ever show the synthetic phantom or a scan opened
 * deliberately within it. Guarantees no previously read case (whose folder or DICOM
 * labels may identify a patient) resurfaces in a recording or screenshot.
 */
export const DEMO_MODE = process.env.CBCTSCOPE_DEMO === '1';

/** Where the opened source persists across dev-server restarts. */
export const SOURCE_STORE = path.join(DATA_DIR, 'source.json');

/** Per-volume annotation/saved-view sidecars (JSON, world-mm coordinates only). */
export const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence');
