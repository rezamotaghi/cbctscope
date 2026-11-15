// The tests that read the built export (out/) skip themselves under `npm test`, which runs
// before `npm run build:web` in the pipelines. So each workflow must name every such test file
// in a `vitest run` step after its `build:web` step, in the same job; otherwise those tests
// never run on GitHub. A new test file that skips without out/ fails here until it is added.
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const rootRequire = createRequire(path.join(root, 'package.json'));
const yaml = createRequire(rootRequire.resolve('electron-builder'))('js-yaml') as { load: (s: string) => unknown };

type Workflow = { jobs: Record<string, { steps?: { run?: string }[] }> };

/** test files that skip when out/ is missing: a skipIf( and the export's folder */
export function exportTests(files: { name: string; source: string }[]): string[] {
  return files
    .filter((f) => f.source.includes('skipIf(') && /process\.cwd\(\),\s*['"]out['"]\)/.test(f.source))
    .map((f) => `tests/${f.name}`)
    .sort();
}

/** the test files a job runs with `vitest run` after its first `build:web` step, per job */
export function runAfterBuild(workflow: Workflow): Set<string>[] {
  return Object.values(workflow.jobs).map((job) => {
    const runs = (job.steps ?? []).map((s) => s.run ?? '');
    const built = runs.findIndex((r) => /npm run build:web\b/.test(r));
    const named = new Set<string>();
    if (built < 0) return named;
    for (const r of runs.slice(built + 1)) {
      for (const line of r.split('\n')) {
        if (!/\bvitest run\b/.test(line)) continue;
        for (const m of line.matchAll(/tests\/[\w./-]+\.test\.ts/g)) named.add(m[0]);
      }
    }
    return named;
  });
}

const testFiles = readdirSync(path.join(root, 'tests'))
  .filter((n) => n.endsWith('.test.ts'))
  .map((name) => ({ name, source: read(`tests/${name}`) }));

describe('the tests that read the export run in every pipeline', () => {
  const needed = exportTests(testFiles);

  it('finds the export tests', () => {
    expect(needed).toEqual(expect.arrayContaining(['tests/siteExport.test.ts', 'tests/webBudget.test.ts']));
  });

  for (const wf of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    it(`${wf} runs each of them after build:web, in one job`, () => {
      const jobs = runAfterBuild(yaml.load(read(wf)) as Workflow);
      const covering = jobs.filter((named) => needed.every((t) => named.has(t)));
      const best = jobs.reduce((m, named) => (named.size > m.size ? named : m), new Set<string>());
      expect(covering.length, `${wf}: missing ${needed.filter((t) => !best.has(t)).join(', ')}`).toBeGreaterThan(0);
    });
  }

  it('the checks recognise a gap', () => {
    const wf: Workflow = {
      jobs: {
        a: { steps: [{ run: 'npx vitest run tests/siteExport.test.ts' }, { run: 'npm run build:web' }, { run: 'npx vitest run tests/webBudget.test.ts' }] },
      },
    };
    const [named] = runAfterBuild(wf);
    expect([...named]).toEqual(['tests/webBudget.test.ts']);
    // the sample is split so this file is not itself taken for an export test
    const outLine = "const out = path.join(process.cwd(), 'o" + "ut');";
    expect(exportTests([{ name: 'x.test.ts', source: `${outLine}\ndescribe.skipIf(!built)('x', () => {});` }])).toEqual(['tests/x.test.ts']);
    expect(exportTests([{ name: 'y.test.ts', source: "describe.skipIf(!process.env.X)('y', () => {});" }])).toEqual([]);
  });
});
