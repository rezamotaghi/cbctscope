// The site's deployment on Vercel (docs/web-build.md, section 9): the prebuilt layout and its
// headers (scripts/vercel-output.mjs), the post-deploy check's pure parts (scripts/site-check.mjs),
// and the workflows that use them: the release job deploys production only after the
// installers are attached, the site update deploys production from main only when the latest
// release is the version it carries, the rehearsal deploys a preview only, CI deploys nothing,
// and the Vercel secrets reach the deploy steps alone.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CONTENT_TYPES, bodyProblem, checkList, contentTypeProblem, deploymentUrl, exportFiles, headerProblems, protectionMessage, refuseProduction, sitemapPaths } from '../scripts/site-check.mjs';
import { FRAME_HEADERS, SITE_HEADERS, headersFor, vercelConfig, writeVercelOutput } from '../scripts/vercel-output.mjs';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const rootRequire = createRequire(path.join(root, 'package.json'));
const yaml = createRequire(rootRequire.resolve('electron-builder'))('js-yaml') as { load: (s: string) => unknown };

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = { needs?: string | string[]; if?: string; permissions?: Record<string, string>; environment?: unknown; steps?: Step[] };
type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; concurrency?: unknown; jobs: Record<string, Job> };
const release = yaml.load(read('.github/workflows/release.yml')) as Workflow;
const rehearsal = yaml.load(read('.github/workflows/site-rehearsal.yml')) as Workflow;
const siteUpdate = yaml.load(read('.github/workflows/site-update.yml')) as Workflow;
const ci = yaml.load(read('.github/workflows/ci.yml')) as Workflow;

/** a miniature export: the files the layout and the check read */
const tmp = mkdtempSync(path.join(os.tmpdir(), 'cbctscope-site-'));
const out = path.join(tmp, 'out');
const files: Record<string, string> = {
  'index.html': '<!doctype html><title>home</title>',
  'about.html': '<!doctype html><title>about</title>',
  'legal.html': '<!doctype html><title>legal</title>',
  // noindex: served at /update, never in the sitemap
  'update.html': '<!doctype html><title>update</title>',
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
    // the update page is left out of the sitemap but still answers at its address
    expect(config.overrides['update.html']).toEqual({ path: 'update', contentType: 'text/html; charset=utf-8' });
  });

  it('serves Next\'s top-level pages at their extensionless addresses and leaves the manual\'s .html addresses alone', () => {
    const { overrides } = vercelConfig([{ file: 'index.html' }, { file: 'about.html' }, { file: 'legal.html' }, { file: 'update.html' }, { file: 'manual/index.html' }, { file: 'manual/mpr.html' }]);
    expect(overrides).toEqual({
      'about.html': { path: 'about', contentType: 'text/html; charset=utf-8' },
      'legal.html': { path: 'legal', contentType: 'text/html; charset=utf-8' },
      'update.html': { path: 'update', contentType: 'text/html; charset=utf-8' },
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
  it('takes the deployment address only when the CLI printed exactly one https address', () => {
    expect(deploymentUrl('https://cbctscope-abc123-team.vercel.app\n')).toBe('https://cbctscope-abc123-team.vercel.app');
    for (const bad of ['', 'Error: no token', 'https://a.vercel.app\nhttps://b.vercel.app', '{"url":"https://cbctscope-x.vercel.app"}', 'http://a.vercel.app']) {
      expect(() => deploymentUrl(bad), bad).toThrow(/not exactly one https address/);
    }
  });

  it('a rehearsal refuses the public domain as its address', () => {
    expect(() => refuseProduction('https://cbctscope.com')).toThrow(/must not check cbctscope.com/);
    expect(() => refuseProduction('https://www.cbctscope.com/')).toThrow(/production address/);
    expect(() => refuseProduction('https://cbctscope.vercel.app', ['cbctscope.vercel.app'])).toThrow(/production address/);
    expect(() => refuseProduction('https://cbctscope-abc123-team.vercel.app')).not.toThrow();
  });

  it('reports a protection wall once, naming the bypass secret', () => {
    expect(protectionMessage(29)).toBe("29 addresses answered 401 or 403: the deployment is behind Vercel's Deployment Protection, and VERCEL_AUTOMATION_BYPASS_SECRET is missing or wrong");
  });

  it('expects a Content-Type for every extension the real export holds, and fails a file type it does not know', () => {
    const real = path.join(root, 'out');
    if (existsSync(path.join(real, 'index.html'))) {
      for (const f of exportFiles(real)) expect(CONTENT_TYPES, f).toHaveProperty(path.extname(f).toLowerCase());
    }
    expect(contentTypeProblem('a.wasm', 'application/wasm')).toBeNull();
    expect(contentTypeProblem('a.js', 'application/javascript; charset=utf-8')).toBeNull();
    expect(contentTypeProblem('a.html', 'text/html; charset=utf-8')).toBeNull();
    expect(contentTypeProblem('a.wasm', 'application/octet-stream')).toBe('Content-Type is "application/octet-stream", expected application/wasm');
    expect(contentTypeProblem('a.js', null)).toMatch(/missing/);
    expect(contentTypeProblem('a.avif', 'image/avif')).toMatch(/no Content-Type is expected for \.avif/);
    for (const ext of ['.html', '.js', '.css', '.wasm', '.json', '.xml', '.txt', '.webp', '.png', '.svg', '.ico']) expect(CONTENT_TYPES).toHaveProperty(ext);
  });

  it('turns the sitemap into site paths and refuses an address on another host', () => {
    expect(sitemapPaths(files['sitemap.xml'])).toEqual(['/', '/about', '/legal', '/manual/', '/manual/mpr.html']);
    expect(() => sitemapPaths('<loc>https://example.com/x</loc>')).toThrow(/not on https:\/\/cbctscope.com/);
    expect(() => sitemapPaths('<urlset></urlset>')).toThrow(/no address/);
  });

  it('checks every sitemap address and every file of the export at the address it is served from, and a 404', () => {
    expect(checkList(out)).toEqual([
      { path: '/', file: 'index.html', status: 200 },
      { path: '/about', file: 'about.html', status: 200 },
      { path: '/legal', file: 'legal.html', status: 200 },
      { path: '/manual/', file: 'manual/index.html', status: 200 },
      { path: '/manual/mpr.html', file: 'manual/mpr.html', status: 200 },
      { path: '/404.html', file: '404.html', status: 200 },
      { path: '/_next/static/chunks/main.js', file: '_next/static/chunks/main.js', status: 200 },
      { path: '/_not-found.html', file: '_not-found.html', status: 200 },
      { path: '/agent-frame.html', file: 'agent-frame.html', status: 200 },
      { path: '/index.html', file: 'index.html', status: 200 },
      { path: '/manual/index.html', file: 'manual/index.html', status: 200 },
      { path: '/robots.txt', file: 'robots.txt', status: 200 },
      { path: '/sitemap.xml', file: 'sitemap.xml', status: 200 },
      { path: '/update', file: 'update.html', status: 200 },
      { path: '/this-address-does-not-exist', file: '404.html', status: 404 },
    ]);
    expect(exportFiles(out)).toHaveLength(Object.keys(files).length);
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
    expect(deploy).toContain('node scripts/site-check.mjs --base-from "$RUNNER_TEMP/deploy.txt" --out out');
    // stdout only goes to the file the check reads
    expect(deploy).toContain('> "$RUNNER_TEMP/deploy.txt"');
    expect(deploy).not.toMatch(/2>&1|&>/);
    // the check comes after the deploy, which comes after the layout
    const names = steps(release, 'deploy').map((s) => s.name);
    expect(names.indexOf('Check the deployment as served')).toBeGreaterThan(names.indexOf('Deploy to production'));
    expect(names.indexOf('Deploy to production')).toBeGreaterThan(names.indexOf('Lay out the prebuilt deployment'));
  });

  it('nothing of GitHub Pages is left, and no job asks for more than it needs', () => {
    const text = read('.github/workflows/release.yml');
    expect(text).not.toMatch(/pages|CNAME|nojekyll|id-token/i);
    expect(release.permissions).toEqual({ contents: 'read' });
    expect(release.jobs.deploy.permissions).toBeUndefined();
    expect(rehearsal.permissions).toEqual({ contents: 'read' });
    expect(read('.github/workflows/site-update.yml')).not.toMatch(/pages|CNAME|nojekyll|id-token/i);
    expect(siteUpdate.permissions).toEqual({ contents: 'read' });
    for (const [name, j] of Object.entries(siteUpdate.jobs)) expect(j.permissions, name).toBeUndefined();
  });

  it('a cancelled or failed run never deploys, and both deploying jobs have a time limit', () => {
    expect(release.jobs.deploy.if).toBe("${{ !cancelled() && needs.build.result == 'success' && needs.publish.result == 'success' }}");
    expect(release.jobs.deploy['timeout-minutes' as keyof Job]).toBe(30);
    expect(rehearsal.jobs.rehearse['timeout-minutes' as keyof Job]).toBe(45);
    expect(siteUpdate.jobs.deploy['timeout-minutes' as keyof Job]).toBe(30);
    // no if: of its own, so the deploy runs only when test and build both succeeded
    expect(siteUpdate.jobs.deploy.if).toBeUndefined();
  });

  it('the deploying jobs run in their GitHub environments, and no other job names a Vercel secret', () => {
    expect(release.jobs.deploy.environment).toBe('production');
    expect(rehearsal.jobs.rehearse.environment).toBe('rehearsal');
    expect(siteUpdate.jobs.deploy.environment).toBe('production');
    for (const [wf, keep] of [
      [release, 'deploy'],
      [rehearsal, 'rehearse'],
      [siteUpdate, 'deploy'],
    ] as const) {
      for (const [name, j] of Object.entries(wf.jobs)) {
        if (name !== keep) expect(JSON.stringify(j), name).not.toMatch(/VERCEL_/);
      }
    }
  });

  it('the Vercel secrets reach the deploy steps only', () => {
    const vercel = ['secrets.VERCEL_TOKEN', 'secrets.VERCEL_ORG_ID', 'secrets.VERCEL_PROJECT_ID'];
    for (const [wf, job, step] of [
      [release, 'deploy', 'Deploy to production'],
      [rehearsal, 'rehearse', 'Deploy a preview'],
      [siteUpdate, 'deploy', 'Deploy to production'],
    ] as const) {
      for (const [name, j] of Object.entries(wf.jobs)) {
        for (const s of j.steps ?? []) {
          const used = secretsIn(s).filter((x) => x.startsWith('secrets.VERCEL_'));
          if (name === job && s.name === step) expect(used.sort()).toEqual([...vercel].sort());
          else if (['Check the preview as served', 'Check the deployment as served'].includes(s.name ?? '')) expect(used).toEqual(['secrets.VERCEL_AUTOMATION_BYPASS_SECRET']);
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
    expect(text).toContain('node scripts/site-check.mjs --base-from "$RUNNER_TEMP/deploy.txt" --out out --attempts 3 --rehearsal');
    expect(steps(rehearsal, 'rehearse').find((s) => s.name === 'Build the web target')?.env).toEqual({ NEXT_PUBLIC_BASE_PATH: '' });
  });

  it('every action is pinned to a commit SHA, and the Vercel CLI to one exact version in deploy/, outside the app', () => {
    for (const f of ['release.yml', 'site-rehearsal.yml', 'site-update.yml']) {
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
      [siteUpdate, 'deploy'],
    ] as const) {
      const install = steps(wf, job).find((s) => s.name === 'Install the Vercel CLI') as (Step & { 'working-directory'?: string }) | undefined;
      expect(install?.run).toBe('npm ci');
      expect(install?.['working-directory']).toBe('deploy');
    }
    // electron-builder packages an allowlist that leaves deploy/ out
    expect(read('electron-builder.yml')).not.toMatch(/deploy\//);
    for (const f of ['release.yml', 'site-rehearsal.yml', 'site-update.yml']) expect(read(`.github/workflows/${f}`), f).not.toMatch(/npx\s+vercel|npm (i|install) -g|vercel@/);
  });
});

describe('the site update (site-update.yml)', () => {
  const steps = (wf: Workflow, job: string) => wf.jobs[job].steps ?? [];
  const deploySteps = steps(siteUpdate, 'deploy');
  const at = (name: string) => deploySteps.findIndex((s) => s.name === name);
  const REF = 'Refuse a run from any ref but main';
  const GUARD = 'Check the latest release is this version and carries the installers';

  it('is started by hand only, and only the two deploy jobs share a concurrency group, so the tests and builds never queue', () => {
    expect(siteUpdate.on).toEqual({ workflow_dispatch: null });
    const group = { group: 'site', 'cancel-in-progress': false };
    for (const wf of [release, siteUpdate]) {
      expect(wf.concurrency).toBeUndefined();
      for (const [name, j] of Object.entries(wf.jobs)) {
        expect((j as Job & { concurrency?: unknown }).concurrency, name).toEqual(name === 'deploy' ? group : undefined);
      }
    }
    expect(rehearsal.concurrency).not.toEqual(group);
  });

  it('its test job runs the release\'s test steps, and its build job builds the site as the release does', () => {
    expect(steps(siteUpdate, 'test')).toEqual(steps(release, 'test'));
    expect(steps(siteUpdate, 'build')).toEqual(steps(release, 'build'));
    const upload = steps(siteUpdate, 'build').find((s) => s.uses?.startsWith('actions/upload-artifact@'));
    // the owner's check of the public address reads the kept artifact
    expect(upload?.with).toMatchObject({ name: 'site', path: 'out', 'retention-days': 30 });
    expect(Object.keys(siteUpdate.jobs)).toEqual(['ref', 'test', 'build', 'deploy']);
    expect(siteUpdate.jobs.test.needs).toBe('ref');
    expect(siteUpdate.jobs.build.needs).toBe('ref');
    expect(siteUpdate.jobs.deploy.needs).toEqual(['ref', 'test', 'build']);
  });

  it('refuses a run from any ref but main in a first job every other job needs, and again first in deploy', () => {
    // the ref job is the one cheap step: no checkout, no install, no environment
    expect(steps(siteUpdate, 'ref')).toHaveLength(1);
    expect(siteUpdate.jobs.ref.needs).toBeUndefined();
    expect(siteUpdate.jobs.ref.environment).toBeUndefined();
    expect(at(REF)).toBe(0);
    expect(deploySteps[0]).toEqual(steps(siteUpdate, 'ref')[0]);
    const run = deploySteps[0].run ?? '';
    expect(run).toContain('if [ "$GITHUB_REF" != "refs/heads/main" ]; then');
    expect(run).toMatch(/deploys from main only: start it again with main selected/);
    expect(run).toContain('exit 1');
  });

  it('runs the version guard before the Vercel CLI is installed or anything is deployed', () => {
    const guard = at(GUARD);
    expect(guard).toBeGreaterThan(at(REF));
    expect(guard).toBeGreaterThan(deploySteps.findIndex((s) => s.uses?.startsWith('actions/checkout@')));
    for (const later of ['Install the Vercel CLI', 'Lay out the prebuilt deployment', 'Deploy to production', 'Check the deployment as served']) {
      expect(guard, later).toBeLessThan(at(later));
    }
    expect(guard).toBeLessThan(deploySteps.findIndex((s) => s.uses?.startsWith('actions/download-artifact@')));
    expect(deploySteps[guard].run).toBe('node scripts/release-assets.mjs --site-update');
    expect(deploySteps[guard].env).toEqual({ GITHUB_TOKEN: '${{ github.token }}' });
  });

  it('after the guards, deploys exactly as the release does, and checks with three attempts', () => {
    const releaseDeploy = steps(release, 'deploy').filter((s) => s.name !== 'Check the release carries the installers');
    expect(deploySteps.filter((s) => s.name !== REF && s.name !== GUARD)).toEqual(releaseDeploy);
    for (const wf of [release, siteUpdate]) {
      const check = steps(wf, 'deploy').find((s) => s.name === 'Check the deployment as served');
      expect(check?.run).toBe('node scripts/site-check.mjs --base-from "$RUNNER_TEMP/deploy.txt" --out out --attempts 3');
    }
  });

});

// With the environment rule for main (docs/web-build.md, section 9, step 11), any job on main
// that names production can read the Vercel secrets. So no file under .github/ but the two
// deploying workflows may name the production environment (as a string or a mapping, in any
// expression), pass a production flag to a CLI, or name a Vercel secret, except the rehearsal's
// job in its own environment. Every string value is read, comments are not.
const DEPLOYERS = ['.github/workflows/release.yml', '.github/workflows/site-update.yml'];
const VERCEL_SECRET = /VERCEL_(TOKEN|ORG_ID|PROJECT_ID|AUTOMATION_BYPASS_SECRET)/;
const PROD_FLAG = /--prod\b|--(target|environment)[\s=]+['"]?production/i;

/** what in a parsed YAML file could reach production or its secrets */
export function productionProblems(doc: unknown): string[] {
  const problems: string[] = [];
  const walk = (node: unknown, where: string, rehearsalJob: boolean) => {
    if (typeof node === 'string') {
      if (PROD_FLAG.test(node)) problems.push(`${where}: a production flag in "${node}"`);
      if (!rehearsalJob && VERCEL_SECRET.test(node)) problems.push(`${where}: a Vercel secret in "${node}"`);
      return;
    }
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`, rehearsalJob));
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'environment' && /production/i.test(JSON.stringify(v))) problems.push(`${where}.environment: names production`);
      if (VERCEL_SECRET.test(k) && !rehearsalJob) problems.push(`${where}.${k}: a Vercel secret's name as a key`);
      walk(v, `${where}.${k}`, rehearsalJob);
    }
  };
  const top = (doc ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(top)) {
    if (k !== 'jobs' || !v || typeof v !== 'object') {
      walk({ [k]: v }, '', false);
      continue;
    }
    for (const [name, job] of Object.entries(v as Record<string, unknown>)) {
      const env = (job as { environment?: unknown } | null)?.environment;
      walk({ [name]: job }, '.jobs', env === 'rehearsal');
    }
  }
  return problems;
}

describe('only release.yml and site-update.yml can reach production', () => {
  const yamlFiles = (dir: string): string[] =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? yamlFiles(`${dir}/${e.name}`) : /\.ya?ml$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );
  const files = yamlFiles('.github');

  it('reads every YAML file under .github/, the workflows, CodeQL and Dependabot included', () => {
    for (const f of ['ci.yml', 'codeql.yml', 'site-rehearsal.yml', 'release.yml', 'site-update.yml']) expect(files).toContain(`.github/workflows/${f}`);
    expect(files).toContain('.github/dependabot.yml');
  });

  it('no other file names the production environment, a production flag or a Vercel secret outside the rehearsal\'s job', () => {
    for (const f of files.filter((x) => !DEPLOYERS.includes(x))) expect(productionProblems(yaml.load(read(f))), f).toEqual([]);
  });

  it('the check finds each form, so it does not pass by finding nothing', () => {
    // the two deploying workflows trip it, by the environment, the flag and the secrets
    for (const f of DEPLOYERS) {
      const found = productionProblems(yaml.load(read(f))).join('\n');
      expect(found, f).toMatch(/environment: names production/);
      expect(found, f).toMatch(/a production flag/);
      expect(found, f).toMatch(/a Vercel secret/);
    }
    const mutate = (edit: (wf: Workflow) => void, file = '.github/workflows/ci.yml') => {
      const wf = yaml.load(read(file)) as Workflow;
      edit(wf);
      return productionProblems(wf);
    };
    const step = (wf: Workflow, s: Step) => wf.jobs.build.steps?.push(s);
    expect(mutate((wf) => (wf.jobs.build.environment = 'production'))).toEqual(['.jobs.build.environment: names production']);
    expect(mutate((wf) => (wf.jobs.build.environment = { name: 'production', url: 'https://cbctscope.com' }))).toEqual(['.jobs.build.environment: names production']);
    expect(mutate((wf) => (wf.jobs.build.environment = "${{ github.ref == 'refs/heads/main' && 'production' || 'rehearsal' }}"))).toHaveLength(1);
    for (const run of ['npx vercel deploy --prod', 'vercel deploy --target production', 'vercel deploy --target=production', 'vercel pull --environment=production']) {
      expect(mutate((wf) => step(wf, { run })), run).toEqual([expect.stringMatching(/a production flag/)]);
    }
    expect(mutate((wf) => step(wf, { run: 'x', env: { T: '${{ secrets.VERCEL_TOKEN }}' } }))).toEqual([expect.stringMatching(/a Vercel secret/)]);
    expect(mutate((wf) => ((wf as unknown as { env: unknown }).env = { VERCEL_ORG_ID: 'x' }))).toEqual([expect.stringMatching(/a Vercel secret's name as a key/)]);
    // the rehearsal's job may name the Vercel secrets only in its own environment, and never --prod
    expect(mutate((wf) => (wf.jobs.rehearse.environment = 'staging'), '.github/workflows/site-rehearsal.yml').length).toBeGreaterThan(0);
    expect(mutate((wf) => wf.jobs.rehearse.steps?.push({ run: 'vercel deploy --prebuilt --prod' }), '.github/workflows/site-rehearsal.yml')).toEqual([expect.stringMatching(/a production flag/)]);
    // a file without jobs, like Dependabot's, is read too
    expect(productionProblems({ updates: [{ registries: ['${{ secrets.VERCEL_TOKEN }}'] }] })).toEqual([expect.stringMatching(/a Vercel secret/)]);
  });
});
