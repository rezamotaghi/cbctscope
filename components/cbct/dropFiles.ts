// A drop on the viewer (docs/web-build.md, section 7): walk the dropped entries recursively
// into File[] with webkitRelativePath set the way `<input type="file" webkitdirectory>` sets
// it ("folder/sub/file"), so the browser loader sees one input shape for the picker and the
// drop. A file dropped on its own keeps an empty relative path, as the single-file input does.

/** the subset of FileSystemEntry the walker uses (typed here so tests can fake it) */
export interface DropEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (f: File) => void, fail?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (entries: DropEntry[]) => void, fail?: (e: unknown) => void) => void };
}

/** limits that keep a stray drop of a home folder from walking forever (the loader re-checks) */
export const DROP_LIMITS = { maxFiles: 8000, maxDepth: 8 };

function withRelativePath(file: File, rel: string): File {
  // webkitRelativePath is a read-only getter on File.prototype; an own property shadows it.
  // Set even when empty, so every walked file carries the property the loader reads.
  Object.defineProperty(file, 'webkitRelativePath', { value: rel, configurable: true });
  return file;
}

function readAll(dir: DropEntry): Promise<DropEntry[]> {
  const reader = dir.createReader?.();
  if (!reader) return Promise.resolve([]);
  const out: DropEntry[] = [];
  // readEntries returns batches (Chromium: 100 at a time) until an empty batch
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(out);
        out.push(...batch);
        next();
      }, reject);
    next();
  });
}

function fileOf(entry: DropEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!entry.file) return reject(new Error('not a file entry'));
    entry.file(resolve, reject);
  });
}

/**
 * Walk dropped entries into files. Files inside a dropped folder get the folder-relative path
 * ("export/DICOM/I0001"); a top-level file keeps an empty relative path.
 */
export async function walkEntries(entries: DropEntry[]): Promise<File[]> {
  const files: File[] = [];
  const visit = async (entry: DropEntry, depth: number, inFolder: boolean): Promise<void> => {
    if (files.length >= DROP_LIMITS.maxFiles) return;
    if (entry.isFile) {
      const f = await fileOf(entry);
      files.push(withRelativePath(f, inFolder ? entry.fullPath.replace(/^\/+/, '') : ''));
    } else if (entry.isDirectory && depth < DROP_LIMITS.maxDepth) {
      for (const child of await readAll(entry)) await visit(child, depth + 1, true);
    }
  };
  for (const e of entries) await visit(e, 0, false);
  return files;
}

/** the label of a drop: the first folder's name, else the single file's name */
export function dropLabel(entries: DropEntry[]): string {
  const dir = entries.find((e) => e.isDirectory);
  if (dir) return dir.name;
  return entries.length === 1 ? entries[0].name : `${entries.length} files`;
}

/** entries of a DataTransfer (read synchronously: the items die after the drop handler returns) */
export function entriesOf(dt: DataTransfer): DropEntry[] {
  const out: DropEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.() as unknown as DropEntry | null;
    if (entry) out.push(entry);
  }
  return out;
}
