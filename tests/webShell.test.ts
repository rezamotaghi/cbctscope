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
import { dropLabel, walkEntries, type DropEntry } from '../components/cbct/dropFiles';
import { createPageTransport, type AgentCommand } from '../components/cbct/agentTransport';
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
  const good = { schema: EVIDENCE_SCHEMA, anon, saved_at: 'x', annotations: [{ a: 1 }], views: [], rois3d: [] };

  it('accepts a marks file of the volume on screen', () => {
    const r = parseMarksFile(JSON.stringify(good), anon);
    expect('file' in r && r.file.annotations).toEqual([{ a: 1 }]);
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

describe('the page transport', () => {
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
