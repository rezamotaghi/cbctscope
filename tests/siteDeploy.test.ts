// The site's deployment on Vercel (docs/web-build.md, section 9): the prebuilt layout and its
// headers (scripts/vercel-output.mjs), the post-deploy check's pure parts (scripts/site-check.mjs),
// and the two workflows that use them: the release job deploys production only after the
// installers are attached, the rehearsal deploys a preview only, and the Vercel secrets reach
// the deploy steps alone.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { bodyProblem, checkList, deploymentUrl, headerProblems, sitemapPaths } from '../scripts/site-check.mjs';
import { FRAME_HEADERS, SITE_HEADERS, headersFor, vercelConfig, writeVercelOutput } from '../scripts/vercel-output.mjs';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const rootRequire = createRequire(path.join(root, 'package.json'));
const yaml = createRequire(rootRequire.resolve('electron-builder'))('js-yaml') as { load: (s: string) => unknown };

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = { needs?: string | string[]; if?: string; permissions?: Record<string, string>; environment?: unknown; steps?: Step[] };
type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; jobs: Record<string, Job> };
const release = yaml.load(read('.github/workflows/release.yml')) as Workflow;
const rehearsal = yaml.load(read('.github/workflows/site-rehearsal.yml')) as Workflow;

/** a miniature export: the files the layout and the check read */
const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbctscope-site-'));
const out = path.join(tmp, 'out');
const files: Record<string, string> = {
  'index.html': '<!doctype html><title>home</title>',
  'about.html': '<!doctype html><title>about</title>',
  'legal.html': '<!doctype html><title>legal</title>',
  '404.html': '<!doctype html><title>not found</title>',
  '_not-found.html': '<!doctype html><title>not found</title>',
  'agent-frame.html': '<!doctype html><title>frame</title>',
  'manual/index.html': '<!doctype html><title>manual</title>',
  'manual/mpr.html': '<!doctype html><title>mpr</title>',
  '_next/static/chunks/main.js': 'console.log(1)',
  'robots.txt': 'User-agent: *\n',
  'sitemap.xml': ['', '/about', '/legal', '/manual/', '/manual/mpr.html'].map((p) => `<url><loc>https://cbctscope.com${p}</loc></url>`).join('\n'),
};
for (const [rel, body] of Object.entries(files)) {
  mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  writeFileSync(path.join(out, rel), body);
}
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('the prebuilt deployment (scripts/vercel-output.mjs)', () => {
  it('copies the export byte for byte and writes a Build Output API v3 config', () => {
    const output = writeVercelOutput(out, tmp);
    for (const [rel, body] of Object.entries(files)) expect(readFileSync(path.join(output, 'static', rel), 'utf8'), rel).toBe(body);
    const config = JSON.parse(readFileSync(path.join(output, 'config.json'), 'utf8'));
    expect(config.version).toBe(3);
  });

  it('serves Next\'s top-level pages at their extensionless addresses and leaves the manual\'s .html addresses alone', () => {
    const { overrides } = vercelConfig([{ file: 'index.html' }, { file: 'about.html' }, { file: 'legal.html' }, { file: 'manual/index.html' }, { file: 'manual/mpr.html' }]);
    expect(overrides).toEqual({
      'about.html': { path: 'about', contentType: 'text/html; charset=utf-8' },
      'legal.html': { path: 'legal', contentType: 'text/html; charset=utf-8' },
    });
  });

  it('adds the three headers everywhere, same-origin framing for the agent frame only, and a 404 on a miss', () => {
    const { routes } = vercelConfig([]);
    const [site, frame, ...rest] = routes;
    expect(site.headers).toEqual(SITE_HEADERS);
    expect(frame.headers).toEqual(FRAME_HEADERS);
    expect(site.continue && frame.continue).toBe(true);
    const re = (src: string | undefined) => new RegExp(src ?? '(?!)');
    for (const p of ['/', '/about', '/manual/mpr.html', '/_next/static/chunks/main.js', '/agent-frame.html.bak']) {
      expect(re(site.src).test(p), p).toBe(true);
      expect(re(frame.src).test(p), p).toBe(false);
    }
    expect(re(site.src).test('/agent-frame.html')).toBe(false);
    expect(re(frame.src).test('/agent-frame.html')).toBe(true);
    expect(rest).toEqual([{ handle: 'filesystem' }, { handle: 'error' }, { src: '^/.*$', dest: '/404.html', status: 404 }]);
    expect(SITE_HEADERS).toEqual({ 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' });
    expect(headersFor('/')).toBe(SITE_HEADERS);
    expect(headersFor('/agent-frame.html')).toBe(FRAME_HEADERS);
    // no header beyond the three; no Referrer-Policy, so outbound links keep the browser default
    expect(Object.keys(FRAME_HEADERS)).toEqual(Object.keys(SITE_HEADERS));
    expect(JSON.stringify(routes)).not.toMatch(/referrer/i);
  });
});

describe('the post-deploy check (scripts/site-check.mjs)', () => {
  it('reads the deployment address from what vercel deploy printed', () => {
    expect(deploymentUrl('https://cbctscope-abc123-team.vercel.app\n')).toBe('https://cbctscope-abc123-team.vercel.app');
    expect(deploymentUrl('{"inspectorUrl":"https://vercel.com/team/cbctscope/x","url":"https://cbctscope-x.vercel.app"}')).toBe('https://cbctscope-x.vercel.app');
    expect(() => deploymentUrl('Error: no token')).toThrow(/no https address/);
  });

  it('turns the sitemap into site paths and refuses an address on another host', () => {
    expect(sitemapPaths(files['sitemap.xml'])).toEqual(['/', '/about', '/legal', '/manual/', '/manual/mpr.html']);
    expect(() => sitemapPaths('<loc>https://example.com/x</loc>')).toThrow(/not on https:\/\/cbctscope.com/);
    expect(() => sitemapPaths('<urlset></urlset>')).toThrow(/no address/);
  });

  it('checks every sitemap address against its file, plus the crawler files, the agent frame and a 404', () => {
    expect(checkList(out)).toEqual([
      { path: '/', file: 'index.html', status: 200 },
      { path: '/about', file: 'about.html', status: 200 },
      { path: '/legal', file: 'legal.html', status: 200 },
      { path: '/manual/', file: 'manual/index.html', status: 200 },
      { path: '/manual/mpr.html', file: 'manual/mpr.html', status: 200 },
      { path: '/sitemap.xml', file: 'sitemap.xml', status: 200 },
      { path: '/robots.txt', file: 'robots.txt', status: 200 },
      { path: '/agent-frame.html', file: 'agent-frame.html', status: 200 },
      { path: '/this-address-does-not-exist', file: '404.html', status: 404 },
    ]);
  });

  it('names each missing or different header', () => {
    expect(headerProblems(new Headers(SITE_HEADERS), SITE_HEADERS)).toEqual([]);
    const got = new Headers({ 'Content-Security-Policy': "frame-ancestors 'none', default-src 'self'", 'X-Frame-Options': 'DENY' });
    expect(headerProblems(got, SITE_HEADERS)).toEqual([
      `Content-Security-Policy is "frame-ancestors 'none', default-src 'self'", expected "frame-ancestors 'none'"`,
      'X-Content-Type-Options is missing, expected "nosniff"',
    ]);
  });

  it('passes identical bytes only, and names an injected script', () => {
    const built = Buffer.from('<html><head></head><body>x</body></html>');
    expect(bodyProblem(built, built)).toBeNull();
    const injected = Buffer.from('<html><head></head><body>x<script src="https://vercel.live/_next-live/feedback/feedback.js"></script></body></html>');
    expect(bodyProblem(injected, built)).toMatch(/first difference at byte 27; the served body carries vercel\.live/);
    expect(bodyProblem(Buffer.from('<html>'), built)).toMatch(/served 6 bytes, built 40/);
  });
});

describe('the workflows', () => {
  const steps = (wf: Workflow, job: string) => wf.jobs[job].steps ?? [];
  const runs = (wf: Workflow, job: string) => steps(wf, job).map((s) => s.run ?? '').join('\n');
  const secretsIn = (s: Step) => JSON.stringify(s).match(/secrets\.\w+/g) ?? [];

  it('the release builds the site for the root and deploys it to production only after build and publish', () => {
    const build = steps(release, 'build').find((s) => s.name === 'Build the web target');
    expect(build?.env).toEqual({ NEXT_PUBLIC_BASE_PATH: '' });
    expect(release.jobs.deploy.needs).toEqual(['build', 'publish']);
    expect(release.on).toEqual({ release: { types: ['published'] } });
    const deploy = runs(release, 'deploy');
    expect(deploy).toContain('node scripts/vercel-output.mjs out "$RUNNER_TEMP/site"');
    expect(deploy).toContain('deploy/node_modules/.bin/vercel deploy --prebuilt --prod --cwd "$RUNNER_TEMP/site"');
    expect(deploy).toContain('node scripts/site-check.mjs --base https://cbctscope.com --out out');
    // the check comes after the deploy, which comes after the layout
    const names = steps(release, 'deploy').map((s) => s.name);
    expect(names.indexOf('Check the site as served')).toBeGreaterThan(names.indexOf('Deploy to production'));
    expect(names.indexOf('Deploy to production')).toBeGreaterThan(names.indexOf('Lay out the prebuilt deployment'));
  });

  it('nothing of GitHub Pages is left, and no job asks for more than it needs', () => {
    const text = read('.github/workflows/release.yml');
    expect(text).not.toMatch(/pages|CNAME|nojekyll|id-token/i);
    expect(release.permissions).toEqual({ contents: 'read' });
    expect(release.jobs.deploy.permissions).toBeUndefined();
    expect(rehearsal.permissions).toEqual({ contents: 'read' });
  });

  it('the Vercel secrets reach the deploy steps only', () => {
    const vercel = ['secrets.VERCEL_TOKEN', 'secrets.VERCEL_ORG_ID', 'secrets.VERCEL_PROJECT_ID'];
    for (const [wf, job, step] of [
      [release, 'deploy', 'Deploy to production'],
      [rehearsal, 'rehearse', 'Deploy a preview'],
    ] as const) {
      for (const [name, j] of Object.entries(wf.jobs)) {
        for (const s of j.steps ?? []) {
          const used = secretsIn(s).filter((x) => x.startsWith('secrets.VERCEL_'));
          if (name === job && s.name === step) expect(used.sort()).toEqual([...vercel].sort());
          else if (name === 'rehearse' && s.name === 'Check the preview as served') expect(used).toEqual(['secrets.VERCEL_AUTOMATION_BYPASS_SECRET']);
          else expect(used, `${name}: ${s.name ?? s.uses ?? s.run}`).toEqual([]);
        }
      }
      expect(steps(wf, job).find((s) => s.name === step)?.env?.VERCEL_TELEMETRY_DISABLED).toBe('1');
    }
  });

  it('the rehearsal is started by hand and deploys a preview, never production', () => {
    expect(rehearsal.on).toEqual({ workflow_dispatch: null });
    const text = runs(rehearsal, 'rehearse');
    expect(text).toContain('deploy/node_modules/.bin/vercel deploy --prebuilt --cwd "$RUNNER_TEMP/site"');
    expect(text).not.toMatch(/--prod|--environment/);
    expect(text).toContain('node scripts/site-check.mjs --base-from "$RUNNER_TEMP/deploy.txt" --out out');
    expect(steps(rehearsal, 'rehearse').find((s) => s.name === 'Build the web target')?.env).toEqual({ NEXT_PUBLIC_BASE_PATH: '' });
  });

  it('every action is pinned to a commit SHA, and the Vercel CLI to one exact version in deploy/, outside the app', () => {
    for (const f of ['release.yml', 'site-rehearsal.yml']) {
      for (const uses of read(`.github/workflows/${f}`).match(/uses: \S+/g) ?? []) expect(uses, f).toMatch(/@[0-9a-f]{40}$/);
    }
    type Pkg = { private?: boolean; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const app = JSON.parse(read('package.json')) as Pkg;
    expect({ ...app.dependencies, ...app.devDependencies }).not.toHaveProperty('vercel');
    const appLock = JSON.parse(read('package-lock.json')) as { packages: Record<string, unknown> };
    expect(appLock.packages).not.toHaveProperty('node_modules/vercel');
    const tool = JSON.parse(read('deploy/package.json')) as Pkg;
    expect(tool.private).toBe(true);
    expect(tool.dependencies).toBeUndefined();
    expect(Object.keys(tool.devDependencies ?? {})).toEqual(['vercel']);
    expect(tool.devDependencies?.vercel).toMatch(/^\d+\.\d+\.\d+$/);
    const toolLock = JSON.parse(read('deploy/package-lock.json')) as { packages: Record<string, { version: string }> };
    expect(toolLock.packages['node_modules/vercel'].version).toBe(tool.devDependencies?.vercel);
    // both workflows install the CLI from deploy/ and run it from there
    for (const [wf, job] of [
      [release, 'deploy'],
      [rehearsal, 'rehearse'],
    ] as const) {
      const install = steps(wf, job).find((s) => s.name === 'Install the Vercel CLI') as (Step & { 'working-directory'?: string }) | undefined;
      expect(install?.run).toBe('npm ci');
      expect(install?.['working-directory']).toBe('deploy');
    }
    // electron-builder packages an allowlist that leaves deploy/ out
    expect(read('electron-builder.yml')).not.toMatch(/deploy\//);
    for (const f of ['release.yml', 'site-rehearsal.yml']) expect(read(`.github/workflows/${f}`), f).not.toMatch(/npx\s+vercel|npm (i|install) -g|vercel@/);
  });
});
