// The folder entrance (docs/web-build.md, section 5): the choice between the directory picker
// and the classic input, and the walk of a picked directory handle into the same File[] the
// classic input and a drop hand the scan.
import { describe, expect, it, vi } from 'vitest';
import { DIRS_STOP_REASON, DROP_LIMITS } from '../components/cbct/dropFiles';
import { chooseFolder, PICKER_ID, usesDirectoryPicker, walkHandle, type FolderHandle } from '../components/cbct/folderPicker';
import { MAX_WALK_DEPTH } from '../lib/shared/dicomScan';
import { scanFiles } from '../lib/browser/scan';

const file = (name: string, body = 'x'): FolderHandle => ({ kind: 'file', name, getFile: async () => new File([body], name) });
const broken = (name: string): FolderHandle => ({
  kind: 'file',
  name,
  getFile: async () => {
    throw new DOMException('the file could not be read', 'NotReadableError');
  },
});
const dir = (name: string, children: FolderHandle[]): FolderHandle => ({
  kind: 'directory',
  name,
  values: async function* () {
    yield* children;
  },
});

describe('the handle walk', () => {
  it('walks nested folders into files with the folder-relative path, labelled by the folder', async () => {
    const root = dir('export', [file('DICOMDIR'), dir('DICOM', [file('I0001'), dir('S1', [file('I0002')])])]);
    const out = await walkHandle(root);
    expect(out.label).toBe('export');
    expect(out.stopped).toBeNull();
    expect(out.files.map((f) => f.webkitRelativePath).sort()).toEqual(['export/DICOM/I0001', 'export/DICOM/S1/I0002', 'export/DICOMDIR']);
    expect(out.files.every((f) => f instanceof File)).toBe(true);
  });

  it('hands hidden files to the scan, which skips them by the same rule as the classic input', async () => {
    const root = dir('export', [file('.DS_Store'), dir('.cache', [file('a')]), file('I0001')]);
    const { files } = await walkHandle(root);
    expect(files.map((f) => f.webkitRelativePath).sort()).toEqual(['export/.DS_Store', 'export/.cache/a', 'export/I0001']);
    const scan = await scanFiles(files);
    expect(scan.ok).toBe(false);
    if (scan.ok) return;
    expect(scan.scanned).toBe(1);
    expect(scan.reasons).toContain(`hidden, or deeper than ${MAX_WALK_DEPTH} folders, skipped: 2 files`);
  });

  it('reaches files eight folders below the picked folder, not nine, as the drop walk does', async () => {
    const chain = (n: number, leaf: FolderHandle): FolderHandle => {
      let node = leaf;
      for (let i = n; i >= 1; i--) node = dir(`d${i}`, [node]);
      return node;
    };
    const root = dir('root', [chain(8, file('deep8.dcm')), chain(9, file('deep9.dcm'))]);
    const { files } = await walkHandle(root);
    expect(files.map((f) => f.webkitRelativePath)).toEqual([`root/${Array.from({ length: 8 }, (_, k) => `d${k + 1}`).join('/')}/deep8.dcm`]);
  });

  it(`stops after ${DROP_LIMITS.maxDirs} folders and says why`, async () => {
    const many = dir('big', Array.from({ length: DROP_LIMITS.maxDirs + 5 }, (_, i) => dir(`f${i}`, [file('x.dcm')])));
    const out = await walkHandle(many);
    expect(out.stopped).toBe(DIRS_STOP_REASON);
    expect(out.files.length).toBe(DROP_LIMITS.maxDirs - 1); // the picked folder counts as one
  });

  it(`stops at ${DROP_LIMITS.maxFiles} files`, async () => {
    const root = dir('big', Array.from({ length: DROP_LIMITS.maxFiles + 10 }, (_, i) => file(`f${i}`)));
    const out = await walkHandle(root);
    expect(out.files.length).toBe(DROP_LIMITS.maxFiles);
  });

  it('a file that fails to read fails the walk with its error, as a dropped one does', async () => {
    const root = dir('export', [file('I0001'), broken('I0002')]);
    await expect(walkHandle(root)).rejects.toThrow('the file could not be read');
  });

  it('a folder that fails to list fails the walk with its error', async () => {
    const root: FolderHandle = {
      kind: 'directory',
      name: 'export',
      values: async function* () {
        yield file('I0001');
        throw new DOMException('the folder is gone', 'NotFoundError');
      },
    };
    await expect(walkHandle(root)).rejects.toThrow('the folder is gone');
  });

  it('reads no bytes: the files are snapshots the scan slices later', async () => {
    const get = vi.fn(async () => new File(['abc'], 'I0001'));
    const out = await walkHandle(dir('export', [{ kind: 'file', name: 'I0001', getFile: get }]));
    expect(get).toHaveBeenCalledTimes(1);
    expect(out.files[0].size).toBe(3);
  });
});

describe('the choice between the two entrances', () => {
  const picked = dir('export', [file('I0001')]);
  const win = (picker?: unknown, secure = true) => ({ isSecureContext: secure, ...(picker ? { showDirectoryPicker: picker } : {}) });

  it('uses the directory picker only where the browser offers it, in a secure context, outside the desktop app', () => {
    const fn = async () => picked;
    expect(usesDirectoryPicker(win(fn), false)).toBe(true);
    expect(usesDirectoryPicker(win(), false)).toBe(false); // Brave, Firefox, Safari
    expect(usesDirectoryPicker(win(fn, false), false)).toBe(false);
    expect(usesDirectoryPicker(win(fn), true)).toBe(false); // the desktop app keeps the classic input
    expect(usesDirectoryPicker(null, false)).toBe(false);
    expect(usesDirectoryPicker(win('not a function'), false)).toBe(false);
  });

  it('asks for read access with a stable id and nothing else', async () => {
    const picker = vi.fn(async () => picked);
    expect(await chooseFolder(win(picker), false)).toEqual({ kind: 'handle', handle: picked });
    expect(picker).toHaveBeenCalledTimes(1);
    expect(picker).toHaveBeenCalledWith({ id: PICKER_ID, mode: 'read' });
  });

  it("the reader's cancel does nothing", async () => {
    const picker = async () => {
      throw new DOMException('The user aborted a request.', 'AbortError');
    };
    expect(await chooseFolder(win(picker), false)).toEqual({ kind: 'canceled' });
  });

  it('any other failure, or no picker, falls back to the classic input', async () => {
    for (const err of [new DOMException('blocked', 'SecurityError'), new TypeError('nope'), new DOMException('x', 'NotAllowedError'), null]) {
      const picker = async () => {
        throw err;
      };
      expect(await chooseFolder(win(picker), false)).toEqual({ kind: 'classic' });
    }
    expect(await chooseFolder(win(async () => file('one.dcm')), false)).toEqual({ kind: 'classic' });
    expect(await chooseFolder(win(), false)).toEqual({ kind: 'classic' });
    const unused = vi.fn(async () => picked);
    expect(await chooseFolder(win(unused), true)).toEqual({ kind: 'classic' });
    expect(unused).not.toHaveBeenCalled();
  });
});
