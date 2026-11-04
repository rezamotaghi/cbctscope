// The web build's pure pieces (docs/web-build.md, sections 2, 4, 6, 7, 8): the CSP string,
// the size-notice decision, the drop walker, the marks-file parser, the page transport.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEB_CSP, WEB_CSP_DIRECTIVES } from '../components/webCsp.mjs';
import {
  DEFAULT_SIZE_NOTICE_MIB,
  formatBytes,
  needsSizeNotice,
  sizeNoticeMiB,
  voxelBytes,
} from '../components/cbct/sizeNotice';
import { DIRS_STOP_REASON, DROP_LIMITS, dropLabel, walkDrop, walkEntries, type DropEntry } from '../components/cbct/dropFiles';
import { MAX_WALK_DEPTH } from '../lib/shared/dicomScan';
import { createPageTransport, type AgentCommand } from '../components/cbct/agentTransport';
import { HELD_BY_SIZE_NOTICE, selectVolumeVerb } from '../components/cbct/agentSelect';
import { AGENT_TIMEOUT_MS } from '../lib/shared/agentTimeout';
import { EVIDENCE_SCHEMA, parseMarksFile } from '../components/cbct/evidence';

describe('the web CSP', () => {
  const directives = new Map(
    WEB_CSP.split(';').map((d) => {
      const [k, ...v] = d.trim().split(/\s+/);
      return [k, v.join(' ')] as const;
    }),
  );

  // the opt-in in-page agent's providers and a loopback model server, and nothing else
  const CONNECT = [
    "'self'",
    'https://api.anthropic.com',
    'https://api.openai.com',
    'https://generativelanguage.googleapis.com',
    'http://127.0.0.1:*',
    'http://localhost:*',
  ];

  it('connect-src is exactly the origin, the three provider APIs and loopback', () => {
    expect(directives.get('connect-src')).toBe(CONNECT.join(' '));
    expect(WEB_CSP_DIRECTIVES['connect-src']).toEqual(CONNECT);
  });

  it('connect-src names every provider base of the agent, and the agent names no other host', () => {
    const hosts = readFileSync(path.join(process.cwd(), 'components/cbct/agent/providers/hosts.ts'), 'utf8');
    const literals = [...hosts.matchAll(/'(https?:\/\/[^']+)'/g)].map((m) => m[1]);
    expect(literals.length).toBeGreaterThanOrEqual(6);
    for (const url of literals) {
      const u = new URL(url);
      const allowed = u.protocol === 'https:' ? CONNECT.includes(u.origin) : CONNECT.includes(`http://${u.hostname}:*`);
      expect(allowed, `${url} is not covered by connect-src`).toBe(true);
    }
  });

  it('carries the contract directives', () => {
    expect(directives.get('default-src')).toBe("'self'");
    expect(directives.get('img-src')).toBe("'self' blob: data:");
    expect(directives.get('worker-src')).toBe("'self' blob:");
    expect(directives.get('style-src')).toBe("'self' 'unsafe-inline'");
    expect(directives.get('script-src')).toBe("'self' 'wasm-unsafe-eval'");
  });

  it("never allows inline or eval'd script", () => {
    expect(directives.get('script-src')).not.toContain("'unsafe-inline'");
    expect(directives.get('script-src')).not.toContain("'unsafe-eval'");
  });
});

describe('the size notice', () => {
  it('reads the build-time threshold, falling back to 512 MiB', () => {
    expect(sizeNoticeMiB(undefined)).toBe(DEFAULT_SIZE_NOTICE_MIB);
    expect(DEFAULT_SIZE_NOTICE_MIB).toBe(512);
    expect(sizeNoticeMiB('')).toBe(512);
    expect(sizeNoticeMiB('abc')).toBe(512);
    expect(sizeNoticeMiB('-4')).toBe(512);
    expect(sizeNoticeMiB('1')).toBe(1);
    expect(sizeNoticeMiB('1024')).toBe(1024);
  });

  it('asks only above the threshold', () => {
    const mib = 1024 * 1024;
    expect(needsSizeNotice(512 * mib, 512)).toBe(false);
    expect(needsSizeNotice(512 * mib + 1, 512)).toBe(true);
    // the phantom (256 x 256 x 200 Int16) is above 1 MiB, the e2e low-threshold build's value
    expect(voxelBytes([256, 256, 200])).toBe(26_214_400);
    expect(needsSizeNotice(voxelBytes([256, 256, 200]), 1)).toBe(true);
    expect(needsSizeNotice(voxelBytes([256, 256, 200]), 512)).toBe(false);
  });

  it('formats the size for the reader', () => {
    expect(formatBytes(730 * 1024 * 1024)).toBe('730 MiB');
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GiB');
  });
});

describe('the drop walker', () => {
  const file = (fullPath: string): DropEntry => {
    const name = fullPath.split('/').pop() as string;
    return { isFile: true, isDirectory: false, name, fullPath, file: (ok) => ok(new File(['x'], name)) };
  };
  const dir = (fullPath: string, children: DropEntry[], batch = 2): DropEntry => ({
    isFile: false,
    isDirectory: true,
    name: fullPath.split('/').pop() as string,
    fullPath,
    createReader: () => {
      let i = 0;
      // readEntries hands out batches until an empty one, as Chromium does
      return {
        readEntries: (ok) => {
          const slice = children.slice(i, i + batch);
          i += batch;
          ok(slice);
        },
      };
    },
  });

  it('walks folders recursively and sets the folder-relative path', async () => {
    const tree = dir('/export', [
      file('/export/DICOMDIR'),
      dir('/export/DICOM', [file('/export/DICOM/I0001'), file('/export/DICOM/I0002'), file('/export/DICOM/I0003')]),
    ]);
    const files = await walkEntries([tree]);
    expect(files.map((f) => f.webkitRelativePath).sort()).toEqual([
      'export/DICOM/I0001',
      'export/DICOM/I0002',
      'export/DICOM/I0003',
      'export/DICOMDIR',
    ]);
    expect(dropLabel([tree])).toBe('export');
  });

  it('reaches as deep as the picker: files eight folders below the dropped folder, not nine', async () => {
    expect(DROP_LIMITS.maxDepth).toBe(MAX_WALK_DEPTH);
    // root/d1/.../d8/deep8.dcm is kept; root/d1/.../d9/deep9.dcm is beyond the picker too
    const chain = (n: number, leaf: DropEntry): DropEntry => {
      let node = leaf;
      for (let i = n; i >= 1; i--) node = dir(`/root/${Array.from({ length: i }, (_, k) => `d${k + 1}`).join('/')}`, [node]);
      return node;
    };
    const p8 = `/root/${Array.from({ length: 8 }, (_, k) => `d${k + 1}`).join('/')}`;
    const p9 = `/root/${Array.from({ length: 9 }, (_, k) => `d${k + 1}`).join('/')}`;
    const root = dir('/root', [chain(8, file(`${p8}/deep8.dcm`)), chain(9, file(`${p9}/deep9.dcm`))]);
    const files = await walkEntries([root]);
    expect(files.map((f) => f.webkitRelativePath)).toEqual([`${p8.slice(1)}/deep8.dcm`]);
  });

  it(`stops after ${DROP_LIMITS.maxDirs} folders and says why`, async () => {
    const many = dir('/big', Array.from({ length: DROP_LIMITS.maxDirs + 5 }, (_, i) => dir(`/big/f${i}`, [file(`/big/f${i}/x.dcm`)])));
    const out = await walkDrop([many]);
    expect(out.stopped).toBe(DIRS_STOP_REASON);
    expect(out.files.length).toBe(DROP_LIMITS.maxDirs - 1); // the dropped folder counts as one
  });

  it('keeps an empty relative path for a file dropped on its own', async () => {
    const files = await walkEntries([file('/volume.dcm')]);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('volume.dcm');
    expect(files[0].webkitRelativePath).toBe('');
    expect(dropLabel([file('/volume.dcm')])).toBe('volume.dcm');
  });
});

describe('the marks file', () => {
  const anon = 'local_0123456789ab';
  const length = {
    annotationUID: 'u0',
    metadata: { toolName: 'Length', FrameOfReferenceUID: `cbctscope.${anon}`, viewPlaneNormal: [0, 0, 1] },
    data: { handles: { points: [[0, 0, 0], [10, 0, 0]] }, label: '' },
  };
  const roi = {
    id: 'r1',
    center: [1, 2, 3],
    axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    half: [2, 2, 2],
    stats: { nVoxels: 8, meanHu: 100, sdHu: 5, minHu: 90, maxHu: 110, volumeCm3: 0.01 },
    visible: true,
  };
  const view = { id: 'v1', name: 'apex', cameras: { a: { position: [0, 0, 1], focalPoint: [0, 0, 0], viewUp: [0, 1, 0] } }, patch: { invert: false } };
  const good = { schema: EVIDENCE_SCHEMA, anon, saved_at: 'x', annotations: [length], views: [view], rois3d: [roi] };

  it('accepts a valid marks file of the volume on screen, nothing dropped', () => {
    const r = parseMarksFile(JSON.stringify(good), anon);
    if (!('file' in r)) throw new Error(r.error);
    expect(r.dropped).toBe(0);
    expect(r.file.annotations).toEqual([length]);
    expect(r.file.views).toEqual([view]);
    expect(r.file.rois3d).toEqual([roi]);
  });

  it('drops a bad annotation, view or ROI and counts it; the rest loads', () => {
    const bad = {
      ...good,
      annotations: [
        length,
        { ...length, metadata: { toolName: 'RunScript' } }, // not a known tool
        { ...length, data: { handles: { points: [[1, 2]] } } }, // a 2-number point
        { ...length, data: { handles: { points: 'x' } } },
        { ...length, metadata: { ...length.metadata, viewUp: ['a', 'b', 'c'] } }, // a typed field, mistyped
      ],
      views: [view, { id: 'v2', name: 3, cameras: {}, patch: {} }],
      rois3d: [roi, { ...roi, center: [1, 2] }],
    };
    const r = parseMarksFile(JSON.stringify(bad), anon);
    if (!('file' in r)) throw new Error(r.error);
    expect(r.dropped).toBe(6);
    expect(r.file.annotations).toEqual([length]);
    expect(r.file.views).toEqual([view]);
    expect(r.file.rois3d).toEqual([roi]);
  });

  it('turns a deeply nested file into a plain message, never a thrown RangeError', () => {
    const depth = 200_000;
    const nested = `{"schema":"${EVIDENCE_SCHEMA}","anon":"local_ffffffffffff","annotations":[${'['.repeat(depth)}${']'.repeat(depth)}]}`;
    let r: ReturnType<typeof parseMarksFile> | undefined;
    expect(() => (r = parseMarksFile(nested, anon))).not.toThrow();
    expect(r).toBeDefined();
    if (r && 'error' in r) expect(r.error).toMatch(/nested too deeply|could not be read|not a CBCTScope/);
    else expect(r?.file.annotations).toEqual([]); // parsed, re-keyed safely, and dropped
  });

  it('refuses another schema and non-JSON', () => {
    expect('error' in parseMarksFile(JSON.stringify({ ...good, schema: 'other' }), anon)).toBe(true);
    expect('error' in parseMarksFile(JSON.stringify({ ...good, anon: 'x', schema: 'other' }), anon)).toBe(true);
    expect('error' in parseMarksFile('not json', anon)).toBe(true);
    expect('error' in parseMarksFile('null', anon)).toBe(true);
  });

  it('re-keys a file saved under another id to the volume on screen', () => {
    // the local app and the web build derive different ids for the same export
    const other = 'local_ffffffffffff';
    const saved = {
      ...good,
      anon: other,
      annotations: [
        {
          annotationUID: 'u1',
          metadata: { toolName: 'Length', FrameOfReferenceUID: `cbctscope.${other}`, volumeId: `cbctlocal:${other}` },
          data: { label: 'keep me', handles: { points: [[1, 2, 3], [4, 5, 6]] } },
        },
      ],
      views: [{ id: 'v1', name: 'apex', cameras: {}, patch: {} }],
      traces: [{ id: 't1' }],
      rois3d: [],
    };
    const r = parseMarksFile(JSON.stringify(saved), anon);
    if (!('file' in r)) throw new Error(r.error);
    expect(r.file.anon).toBe(anon);
    expect(JSON.stringify(r.file)).not.toContain(other);
    const a = r.file.annotations[0] as { metadata: Record<string, string>; data: { label: string; handles: unknown } };
    expect(a.metadata.FrameOfReferenceUID).toBe(`cbctscope.${anon}`);
    expect(a.metadata.volumeId).toBe(`cbctlocal:${anon}`);
    expect(a.data.label).toBe('keep me');
    expect(a.data.handles).toEqual({ points: [[1, 2, 3], [4, 5, 6]] });
    expect(r.file.views).toEqual(saved.views);
    expect(r.file.traces).toEqual(saved.traces);
  });
});

describe('the agent select_volume', () => {
  it('answers an error when the size notice holds the volume, never ok', () => {
    const known = [{ anon: 'local_aaaaaaaaaaaa' }];
    expect(selectVolumeVerb('local_aaaaaaaaaaaa', known, () => 'held')).toBe(HELD_BY_SIZE_NOTICE);
    expect(selectVolumeVerb('local_aaaaaaaaaaaa', known, () => 'switched')).toBeNull();
    expect(selectVolumeVerb('local_bbbbbbbbbbbb', known, () => 'switched')).toMatch(/unknown volume id/);
  });
});

describe('the page transport', () => {
  it('a dispatch times out like the bus and honours Stop', async () => {
    const t = createPageTransport();
    t.subscribe(() => {}, () => {}); // a viewer that never answers
    await expect(t.dispatch('get_state', {}, { timeoutMs: 30 })).resolves.toEqual({ ok: false, error: 'viewer did not answer within 0.03s' });
    const stop = new AbortController();
    const p = t.dispatch('get_state', {}, { signal: stop.signal });
    stop.abort();
    await expect(p).resolves.toEqual({ ok: false, error: 'stopped' });
    const pre = new AbortController();
    pre.abort();
    await expect(t.dispatch('get_state', {}, { signal: pre.signal })).resolves.toEqual({ ok: false, error: 'stopped' });
    expect(AGENT_TIMEOUT_MS).toBe(15_000);
  });

  it('queues until a subscriber, then round-trips the outcome', async () => {
    const t = createPageTransport();
    const pending = t.dispatch('get_state');
    const seen: AgentCommand[] = [];
    t.subscribe(
      (cmd) => {
        seen.push(cmd);
        void t.reply(cmd.id, { ok: true, result: { verb: cmd.verb } });
      },
      () => {},
    );
    await expect(pending).resolves.toEqual({ ok: true, result: { verb: 'get_state' } });
    expect(seen.map((c) => c.verb)).toEqual(['get_state']);
  });

  it('a second subscriber evicts the first', async () => {
    const t = createPageTransport();
    let evicted = 0;
    const firstGot: string[] = [];
    t.subscribe((c) => firstGot.push(c.verb), () => evicted++);
    t.subscribe((c) => void t.reply(c.id, { ok: false, error: 'second' }), () => {});
    expect(evicted).toBe(1);
    await expect(t.dispatch('snapshot')).resolves.toEqual({ ok: false, error: 'second' });
    expect(firstGot).toEqual([]);
  });
});
