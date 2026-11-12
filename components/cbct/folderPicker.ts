// The folder entrance of the web build (docs/web-build.md, section 5). Two pickers feed one
// loader: where the browser offers the File System Access directory picker, the folder item
// opens it in read mode, because Chromium's classic folder input (<input webkitdirectory>)
// follows the pick with its own "Upload N files to this site?" confirmation, the opposite of
// what happens. Elsewhere, or when the picker is blocked or fails, the classic input opens as
// before. The handle is walked through the drop walker (dropFiles.ts), so the scan sees the
// same File[] with the same relative paths, limits and stop reason as a dropped folder.
// Read access only; the handle is never stored, and nothing is asked again later.
import { walkDrop, type DropEntry } from './dropFiles';

/** the subset of FileSystemHandle the walk uses (typed here so tests can fake it) */
export interface FolderHandle {
  kind: 'file' | 'directory';
  name: string;
  /** a file handle: a File snapshot (no bytes are read until the scan slices it) */
  getFile?: () => Promise<File>;
  /** a directory handle: its children */
  values?: () => AsyncIterable<FolderHandle>;
}

type PickerWindow = {
  isSecureContext?: boolean;
  showDirectoryPicker?: (options: { id: string; mode: 'read' }) => Promise<FolderHandle>;
};

/** the picker's remembered-place key: it reopens in the last folder picked through it */
export const PICKER_ID = 'cbctscope-dicom-folder';

/**
 * Whether the folder item opens the directory picker: decided by feature detection, never by
 * the browser's name. Brave, Firefox and Safari have no `showDirectoryPicker`; the desktop app
 * keeps the classic input (`desktop` true), whose native panel has not been checked with it.
 */
export function usesDirectoryPicker(win: unknown, desktop: boolean): boolean {
  if (desktop || !win) return false;
  const w = win as PickerWindow;
  return w.isSecureContext !== false && typeof w.showDirectoryPicker === 'function';
}

export type FolderChoice =
  | { kind: 'handle'; handle: FolderHandle }
  /** the reader closed the picker: nothing happens */
  | { kind: 'canceled' }
  /** no directory picker, or it failed: open the classic input */
  | { kind: 'classic' };

/** open the directory picker where it is offered; every failure but the reader's cancel falls back */
export async function chooseFolder(win: unknown, desktop: boolean): Promise<FolderChoice> {
  if (!usesDirectoryPicker(win, desktop)) return { kind: 'classic' };
  try {
    const handle = await (win as Required<PickerWindow>).showDirectoryPicker({ id: PICKER_ID, mode: 'read' });
    if (!handle || handle.kind !== 'directory') return { kind: 'classic' };
    return { kind: 'handle', handle };
  } catch (e) {
    if ((e as { name?: unknown } | null)?.name === 'AbortError') return { kind: 'canceled' };
    return { kind: 'classic' };
  }
}

/** a handle seen as a drop entry, so the drop walker walks it (fullPath "/root/sub/name") */
export function handleEntry(handle: FolderHandle, parent = ''): DropEntry {
  const fullPath = `${parent}/${handle.name}`;
  if (handle.kind === 'file') {
    return {
      isFile: true,
      isDirectory: false,
      name: handle.name,
      fullPath,
      file: (ok, fail) => {
        const get = handle.getFile;
        if (!get) return fail?.(new Error('not a file handle'));
        get.call(handle).then(ok, (e) => fail?.(e));
      },
    };
  }
  return {
    isFile: false,
    isDirectory: true,
    name: handle.name,
    fullPath,
    createReader: () => {
      let done = false;
      // one batch with every child, then the empty batch that ends the walker's read loop
      return {
        readEntries: (ok, fail) => {
          if (done) return ok([]);
          done = true;
          const out: DropEntry[] = [];
          void (async () => {
            if (handle.values) for await (const child of handle.values.call(handle)) out.push(handleEntry(child, fullPath));
            return out;
          })().then(ok, (e) => fail?.(e));
        },
      };
    },
  };
}

/** a picked folder into files: the drop walk, with the folder's name as the label */
export async function walkHandle(handle: FolderHandle): Promise<{ files: File[]; stopped: string | null; label: string }> {
  const { files, stopped } = await walkDrop([handleEntry(handle)]);
  return { files, stopped, label: handle.name };
}
