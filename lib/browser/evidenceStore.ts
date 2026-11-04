// BROWSER. Evidence sidecars (annotations, saved views, ROIs, traces) in IndexedDB: database
// `cbctscope`, object store `evidence`, key = the volume id, value = the EvidenceFile JSON
// unchanged (the same document the server writes to its sidecar file; never pixels).
//
// Every call degrades: a blocked, absent or failing IndexedDB (private windows, disabled
// storage, a test runner) reads as "no sidecar" and a write reports false. Nothing throws
// into the viewer.
import { EVIDENCE_SCHEMA, type EvidenceFile } from '../../components/cbct/evidence';
import { VOLUME_ID_RE } from '../shared/dicom';

/** the storage the evidence store sits on; IndexedDB in the page, injectable for tests */
export interface KeyValueAdapter {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
}

export const EVIDENCE_DB = 'cbctscope';
export const EVIDENCE_STORE = 'evidence';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** IndexedDB adapter; rejects (and the store degrades) when IndexedDB is missing or blocked. */
export function indexedDbAdapter(factory: IDBFactory | undefined = globalThis.indexedDB): KeyValueAdapter {
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () => {
    if (!dbp) {
      dbp = new Promise<IDBDatabase>((resolve, reject) => {
        if (!factory) return reject(new Error('IndexedDB is not available'));
        const open = factory.open(EVIDENCE_DB, 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains(EVIDENCE_STORE)) open.result.createObjectStore(EVIDENCE_STORE);
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(new Error('IndexedDB is blocked'));
      });
      dbp.catch(() => {
        dbp = null; // retry on the next call: storage may become available
      });
    }
    return dbp;
  };
  return {
    async get(key) {
      const tx = (await db()).transaction(EVIDENCE_STORE, 'readonly');
      return req(tx.objectStore(EVIDENCE_STORE).get(key));
    },
    async put(key, value) {
      const tx = (await db()).transaction(EVIDENCE_STORE, 'readwrite');
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      tx.objectStore(EVIDENCE_STORE).put(value, key);
      await done;
    },
  };
}

export function createEvidenceStore(adapter: KeyValueAdapter = indexedDbAdapter()) {
  return {
    async get(anon: string): Promise<EvidenceFile | null> {
      if (!VOLUME_ID_RE.test(anon)) return null;
      try {
        const v = (await adapter.get(anon)) as EvidenceFile | undefined;
        if (!v || typeof v !== 'object' || v.schema !== EVIDENCE_SCHEMA || v.anon !== anon) return null;
        return v;
      } catch {
        return null;
      }
    },
    async put(file: EvidenceFile): Promise<boolean> {
      if (!file || file.schema !== EVIDENCE_SCHEMA || !VOLUME_ID_RE.test(file.anon)) return false;
      try {
        // a plain-JSON copy: what the server would have stored, detached from viewer objects
        await adapter.put(file.anon, JSON.parse(JSON.stringify(file)));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export type EvidenceStore = ReturnType<typeof createEvidenceStore>;
