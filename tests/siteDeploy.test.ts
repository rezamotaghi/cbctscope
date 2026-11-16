// The site on Vercel (docs/web-build.md, section 9): Vercel's Git integration builds every push
// with vercel.json, whose build command runs the site's web build and then the layout
// (scripts/vercel-output.mjs, the one place the response headers live); no workflow deploys or
// can reach a Vercel secret; the alarm after a production deployment (site-check.yml) runs the
// live mode of scripts/site-check.mjs, whose pure parts are tested here with fixtures; the byte
// mode stays for an export on disk.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CONTENT_TYPES,
  FORBIDDEN_MARKERS,
  LIVE_FILES,
  MISSING_PATH,
  checkList,
  commitProblem,
  contentTypeProblem,
  counterProblems,
  counterScriptProblem,
  exportFiles,
  forbiddenMarkers,
  headerProblems,
  liveList,
  liveOptions,
  newestSentence,
  offOriginAssets,
  pageAssets,
  protectionMessage,
  sitemapPaths,
  typeFileFor,
  versionProblem,
} from '../scripts/site-check.mjs';
import { COUNTER_TAG } from '../scripts/site-counter.mjs';
import { SITE_ENV, STRIPPED, siteBuildEnv } from '../scripts/site-env.mjs';
import { COMMIT_HEADER, FRAME_HEADERS, SITE_HEADERS, commitFrom, headersFor, vercelConfig, writeVercelOutput } from '../scripts/vercel-output.mjs';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const rootRequire = createRequire(path.join(root, 'package.json'));
const yaml = createRequire(rootRequire.resolve('electron-builder'))('js-yaml') as { load: (s: string) => unknown };
const minimatch = rootRequire('minimatch') as (name: string, pattern: string) => boolean;

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = { needs?: string | string[]; if?: string; permissions?: Record<string, string>; environment?: unknown; 'timeout-minutes'?: number; steps?: Step[] };
type Workflow = { on: Record<string, unknown>; permissions: Record<string, string>; concurrency?: { group?: string; 'cancel-in-progress'?: boolean }; jobs: Record<string, Job> };
const alarm = yaml.load(read('.github/workflows/site-check.yml')) as Workflow;
const ci = yaml.load(read('.github/workflows/ci.yml')) as Workflow;
const vercel = JSON.parse(read('vercel.json')) as Record<string, unknown>;
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string>; engines: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> };
const SHA = 'fa1eade47b73733d6312d5abfad33ce9e4068081';

/** a miniature export: the files the layout and the byte check read */
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

describe('vercel.json: Vercel builds the site from the repository', () => {
  it('has exactly these keys: no framework preset, npm ci, the site build, and no Dependabot deployments', () => {
    expect(vercel).toEqual({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: null,
      installCommand: 'npm ci',
      buildCommand: 'npm run build:vercel',
      git: { deploymentEnabled: { 'dependabot/**': false } },
    });
  });

  it('defines no header, route or redirect of its own: the layout script is the one place', () => {
    for (const key of ['headers', 'routes', 'rewrites', 'redirects', 'cleanUrls', 'trailingSlash', 'outputDirectory', 'env', 'build', 'github'])
      expect(vercel, key).not.toHaveProperty(key);
    expect(read('vercel.json')).not.toMatch(/frame-ancestors|nosniff|X-Frame-Options/i);
  });

  // Vercel deploys a middleware file at the root as Routing Middleware, whatever the build
  // command wrote: the first preview of this arrangement answered every address with an error
  // from the local app's loopback guard. .vercelignore keeps it, and whatever imports it, out
  // of what Vercel builds, and no other root entry may become code on Vercel.
  it('.vercelignore keeps the loopback guard and its importers out of what Vercel builds', () => {
    const ignored = read('.vercelignore').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    expect(ignored).toContain('/middleware.ts');
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(e.name) && /from ['"](\.\.\/)+middleware['"]/.test(read(rel))) importers.push(`/${rel}`);
      }
    };
    for (const dir of ['tests', 'app', 'components', 'lib']) walk(dir);
    expect(importers).not.toEqual([]);
    for (const rel of importers) expect(ignored, rel).toContain(rel);
    const rootEntries = readdirSync(root);
    for (const name of rootEntries.filter((n) => /^(middleware|proxy)\.(js|mjs|cjs|ts|mts)$/.test(n)))
      expect(ignored, name).toContain(`/${name}`);
    expect(rootEntries).not.toContain('api');
  });

  it('the Dependabot pattern matches its branches and no other (minimatch, as Vercel documents)', () => {
    const [pattern] = Object.keys((vercel.git as { deploymentEnabled: Record<string, boolean> }).deploymentEnabled);
    for (const b of ['dependabot/npm_and_yarn/next-15.5.23', 'dependabot/npm_and_yarn/mcp/zod-4.3.0', 'dependabot/github_actions/actions/checkout-7.1.0']) expect(minimatch(b, pattern), b).toBe(true);
    for (const b of ['main', 'vercel-deploys', 'fix/dependabot', 'dependabot']) expect(minimatch(b, pattern), b).toBe(false);
  });

  it('the build command runs the site build and ends in the layout script', () => {
    const steps = pkg.scripts['build:vercel'].split('&&').map((s) => s.trim());
    expect(steps).toEqual(['node scripts/build-web.mjs --site', 'node scripts/vercel-output.mjs']);
    expect(steps.at(-1)).toBe('node scripts/vercel-output.mjs');
    // the layout's defaults are the export of that build and the project root, where Vercel reads .vercel/output
    expect(read('scripts/vercel-output.mjs')).toContain("const [outDir = 'out', dest = '.'] = process.argv.slice(2);");
    expect(read('.gitignore')).toMatch(/^\/\.vercel\/$/m);
  });

  it('npm ci downloads nothing the site build does not use: no Electron binary, no Playwright browser', () => {
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { hasInstallScript?: boolean; version?: string }> };
    // Electron fetches its binary on first use, not on install; a release that brings back an
    // install step fails here, and the site's build then needs ELECTRON_SKIP_BINARY_DOWNLOAD
    for (const p of ['node_modules/electron', 'node_modules/@playwright/test', 'node_modules/playwright', 'node_modules/playwright-core']) {
      expect(lock.packages[p], p).toBeDefined();
      expect(lock.packages[p].hasInstallScript, p).toBeUndefined();
    }
    expect(JSON.parse(read('node_modules/electron/package.json')).scripts ?? {}).not.toHaveProperty('postinstall');
  });

  it('the site build sees no variable Vercel sets, the root of the domain, and Next telemetry off', () => {
    const given = {
      PATH: '/usr/bin',
      HOME: '/root',
      VERCEL: '1',
      VERCEL_ENV: 'preview',
      VERCEL_URL: 'cbctscope-abc.vercel.app',
      VERCEL_BRANCH_URL: 'cbctscope-git-x.vercel.app',
      VERCEL_PROJECT_PRODUCTION_URL: 'cbctscope.com',
      VERCEL_GIT_COMMIT_SHA: SHA,
      NEXT_PUBLIC_VERCEL_URL: 'cbctscope-abc.vercel.app',
      NOW_REGION: 'dev1',
      NEXT_PUBLIC_BASE_PATH: '/cbctscope',
      NEXT_PUBLIC_CBCTSCOPE_SIZE_NOTICE_MIB: '1',
      CBCTSCOPE_OUT_DIR: 'out-small',
      CI: '1',
    };
    expect(siteBuildEnv(given)).toEqual({ PATH: '/usr/bin', HOME: '/root', CI: '1', NEXT_PUBLIC_BASE_PATH: '', NEXT_TELEMETRY_DISABLED: '1' });
    expect(SITE_ENV).toEqual({ NEXT_PUBLIC_BASE_PATH: '', NEXT_TELEMETRY_DISABLED: '1' });
  });

  it('every Vercel variable Next reads while it builds is stripped from the site build', () => {
    const found = new Set<string>();
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js')) for (const m of readFileSync(p, 'utf8').matchAll(/process\.env\.((?:VERCEL|NOW)_?\w*)/g)) found.add(m[1]);
      }
    };
    walk(path.join(root, 'node_modules/next/dist/lib/metadata'));
    expect([...found]).toEqual(expect.arrayContaining(['VERCEL_ENV', 'VERCEL_URL']));
    for (const name of found) expect(STRIPPED.test(name), name).toBe(true);
  });

  it('build-web --site uses that environment and says which Node.js built it', () => {
    const src = read('scripts/build-web.mjs');
    expect(src).toContain("const env = { ...(site ? siteBuildEnv(process.env) : process.env), CBCTSCOPE_TARGET: 'web', NEXT_PUBLIC_CBCTSCOPE_TARGET: 'web' };");
    expect(src).toContain('Node.js ${process.version}');
    // no page reads a Vercel variable either
    for (const dir of ['app', 'components', 'lib']) {
      const walk = (d: string): string[] =>
        readdirSync(path.join(root, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(tsx?|mjs)$/.test(e.name) ? [`${d}/${e.name}`] : []));
      for (const f of walk(dir)) expect(read(f), f).not.toMatch(/process\.env\.(VERCEL|NEXT_PUBLIC_VERCEL)/);
    }
    expect(read('next.config.mjs')).not.toMatch(/VERCEL/);
  });

  it('engines is a bounded range, so Vercel cannot move to a new Node major unannounced', () => {
    // Vercel deploys the newest available major inside the range (26.x today); raising the bound is a deliberate change
    expect(pkg.engines).toEqual({ node: '>=22 <27' });
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { engines?: Record<string, string> }> };
    expect(lock.packages[''].engines).toEqual(pkg.engines);
  });

  it('CI runs the Vercel build command and checks the layout it leaves', () => {
    const web = ci.jobs.web.steps ?? [];
    const runs = web.map((s) => s.run ?? '');
    const build = runs.indexOf('npm run build:vercel');
    expect(build).toBeGreaterThan(runs.indexOf('npm run build:web'));
    expect(build).toBeGreaterThan(runs.indexOf('npm run test:e2e'));
    const check = web[build + 1];
    expect(check.name).toBe('Check the Build Output API layout');
    for (const part of ['.vercel/output/config.json', 'c.version !== 3', '.vercel/output/static/index.html', 'throw new Error']) expect(check.run, part).toContain(part);
    // the export tests again, told to expect the site's build: the counter in exactly the
    // sitemap's pages. The first run, after the plain build, sets no flavour and expects none.
    expect(runs[build + 2]).toBe('npx vitest run tests/siteExport.test.ts');
    expect(web[build + 2].env).toEqual({ CBCTSCOPE_EXPORT: 'site' });
    const plain = web.find((s) => (s.run ?? '').includes('tests/siteExport.test.ts'));
    expect(plain).not.toBe(web[build + 2]);
    expect(plain?.env).toBeUndefined();
    expect(read('tests/siteExport.test.ts')).toContain("const SITE_EXPORT = process.env.CBCTSCOPE_EXPORT === 'site';");
  });
});

describe('the layout (scripts/vercel-output.mjs)', () => {
  it('copies the export byte for byte and writes a Build Output API v3 config with the headers', () => {
    const output = writeVercelOutput(out, tmp);
    for (const [rel, body] of Object.entries(files)) expect(readFileSync(path.join(output, 'static', rel), 'utf8'), rel).toBe(body);
    const config = JSON.parse(readFileSync(path.join(output, 'config.json'), 'utf8'));
    expect(config.version).toBe(3);
    expect(config.routes[0].headers).toEqual(SITE_HEADERS);
    expect(config.routes[1].headers).toEqual(FRAME_HEADERS);
    // the update page is left out of the sitemap but still answers at its address
    expect(config.overrides['update.html']).toEqual({ path: 'update', contentType: 'text/html; charset=utf-8' });
  });

  it('names the commit on every address when given one, and only a full SHA', () => {
    expect(commitFrom(SHA)).toBe(SHA);
    for (const bad of [undefined, '', 'main', SHA.slice(0, 7), SHA.toUpperCase(), `${SHA}\n`]) expect(commitFrom(bad), String(bad)).toBeNull();
    const output = writeVercelOutput(out, tmp, SHA);
    const { routes } = JSON.parse(readFileSync(path.join(output, 'config.json'), 'utf8'));
    expect(routes[0].headers).toEqual({ ...SITE_HEADERS, [COMMIT_HEADER]: SHA });
    expect(routes[1].headers).toEqual({ ...FRAME_HEADERS, [COMMIT_HEADER]: SHA });
    expect(COMMIT_HEADER).toBe('X-CBCTScope-Commit');
    // no page carries it: the static copy is the export, byte for byte
    for (const [rel, body] of Object.entries(files)) expect(readFileSync(path.join(output, 'static', rel), 'utf8'), rel).toBe(body);
    expect(JSON.stringify(vercelConfig([]))).not.toContain(COMMIT_HEADER);
    expect(read('scripts/vercel-output.mjs')).toContain('commitFrom(process.env.VERCEL_GIT_COMMIT_SHA)');
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

describe('the live check (scripts/site-check.mjs --live)', () => {
  const sitemap = files['sitemap.xml'];

  it('checks the live sitemap\'s addresses, then the fixed files of the layout, each once', () => {
    expect(LIVE_FILES).toEqual(['/robots.txt', '/sitemap.xml', '/icon.svg', '/apple-icon.png', '/favicon.ico', '/og-card.png', '/update', '/agent-frame.html', '/manual/']);
    expect(liveList(sitemap)).toEqual(['/', '/about', '/legal', '/manual/', '/manual/mpr.html', '/robots.txt', '/sitemap.xml', '/icon.svg', '/apple-icon.png', '/favicon.ico', '/og-card.png', '/update', '/agent-frame.html']);
    // the sitemap parser is the byte mode's: an address off the site or an empty sitemap fails
    expect(() => liveList('<loc>https://example.com/x</loc>')).toThrow(/not on https:\/\/cbctscope.com/);
    expect(() => liveList('<urlset></urlset>')).toThrow(/no address/);
    expect(MISSING_PATH).toBe('/this-address-does-not-exist');
  });

  it('types an extensionless address or a folder as HTML', () => {
    expect(typeFileFor('/')).toBe('/index.html');
    expect(typeFileFor('/manual/')).toBe('/manual/index.html');
    expect(typeFileFor('/update')).toBe('/update.html');
    expect(typeFileFor('/og-card.png')).toBe('/og-card.png');
    expect(contentTypeProblem(typeFileFor('/about'), 'text/html; charset=utf-8')).toBeNull();
    expect(contentTypeProblem(typeFileFor('/about'), 'text/plain')).toMatch(/expected text\/html/);
  });

  it('lists the markers of Vercel\'s analytics stub and package, speed insights and toolbar in one place, and finds each', () => {
    expect(FORBIDDEN_MARKERS).toEqual(['/_vercel/speed-insights/', 'window.vaq', 'window.siq', '@vercel/analytics', '@vercel/speed-insights', 'https://vercel.live']);
    const clean = '<html><head><script src="/_next/static/chunks/main.js"></script></head><body>window.value</body></html>';
    expect(forbiddenMarkers(clean)).toEqual([]);
    // the counter's own tag is not a forbidden marker: the counter rule checks it (site-counter.mjs)
    expect(forbiddenMarkers(clean.replace('</head>', `${COUNTER_TAG}</head>`))).toEqual([]);
    const injected = [
      ['<script defer src="/_vercel/speed-insights/script.js"></script>', '/_vercel/speed-insights/'],
      ['<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>', 'window.vaq'],
      ['<script>window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };</script>', 'window.siq'],
      ['<script src="https://vercel.live/_next-live/feedback/feedback.js"></script>', 'https://vercel.live'],
    ];
    for (const [tag, marker] of injected) expect(forbiddenMarkers(clean.replace('</body>', `${tag}</body>`)), marker).toEqual([marker]);
  });

  it('the live mode holds every sitemap page to the counter tag once and every other page to none', () => {
    const page = (extra = '') => `<html><head><meta charSet="utf-8"/>${extra}</head><body></body></html>`;
    const counted = new Set(['/', '/about', '/manual/']);
    const good = new Map([
      ['/', page(COUNTER_TAG)],
      ['/about', page(COUNTER_TAG)],
      ['/manual/', page(COUNTER_TAG)],
      ['/update', page()],
      ['/agent-frame.html', page()],
      [MISSING_PATH, page()],
      ['/404.html', page()],
    ]);
    expect(counterProblems(good, counted)).toEqual([]);
    const bad = new Map(good);
    bad.set('/about', page());
    bad.set('/manual/', page(COUNTER_TAG + COUNTER_TAG));
    bad.set('/update', page(COUNTER_TAG));
    bad.set('/404.html', page('<link rel="preload" href="/_vercel/insights/other.js"/>'));
    bad.delete('/');
    const lines = counterProblems(bad, counted);
    expect(lines).toHaveLength(5);
    expect(lines.join('\n')).toMatch(/^\/about: carries the counter tag 0 times/m);
    expect(lines.join('\n')).toMatch(/^\/manual\/: carries the counter tag 2 times/m);
    expect(lines.join('\n')).toMatch(/^\/update: carries 1 references to \/_vercel\/insights\/, expected none/m);
    expect(lines.join('\n')).toMatch(/^\/404\.html: carries 1 references/m);
    expect(lines.join('\n')).toMatch(/^\/: not read/m);
    // a counted page with the tag and a second reference to the routes
    expect(counterProblems(new Map([['/', page(COUNTER_TAG + '<script src="/_vercel/insights/x.js"></script>')]]), new Set(['/']))[0]).toMatch(/carries 2 references to \/_vercel\/insights\/, expected only the counter tag/);
  });

  it('the live mode requires the counter script, and says to enable Web Analytics when it is missing', () => {
    expect(counterScriptProblem(200, 'application/javascript; charset=utf-8')).toBeNull();
    expect(counterScriptProblem(200, 'text/javascript')).toBeNull();
    expect(counterScriptProblem(404, 'text/html')).toMatch(/status 404, expected 200: enable Web Analytics in the Vercel project/);
    expect(counterScriptProblem(200, 'text/html')).toMatch(/expected application\/javascript or text\/javascript: enable Web Analytics in the Vercel project/);
  });

  it('collects every script and stylesheet a page references, resolved against the page', () => {
    const html = [
      '<link rel="stylesheet" href="/_next/static/css/a.css" data-precedence="next"/>',
      '<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/webpack.js"/>',
      '<link rel="preload" as="image" href="/og-card.png"/>',
      '<link rel="canonical" href="https://cbctscope.com/manual/">',
      '<link rel="icon" href="/icon.svg?53e3" type="image/svg+xml"/>',
      '<script src="manual.js"></script>',
      '<script async="" src="/_next/static/chunks/main.js"></script>',
      '<script type="application/ld+json">{"@context":"https://schema.org"}</script>',
      '<script>self.__next_f=[]</script>',
    ].join('');
    expect(pageAssets(html, 'https://cbctscope.com/manual/')).toEqual([
      'https://cbctscope.com/manual/manual.js',
      'https://cbctscope.com/_next/static/chunks/main.js',
      'https://cbctscope.com/_next/static/css/a.css',
      'https://cbctscope.com/_next/static/chunks/webpack.js',
    ]);
  });

  it('fails a script or stylesheet on another origin, a protocol-relative one included', () => {
    const page = 'https://cbctscope.com/';
    expect(offOriginAssets(pageAssets('<script src="/_next/a.js"></script><link rel="stylesheet" href="b.css">', page), 'https://cbctscope.com')).toEqual([]);
    const html = '<script src="https://va.example.com/script.js"></script><script src="//cdn.example.net/x.js"></script><link rel="stylesheet" href="http://cbctscope.com/c.css">';
    expect(offOriginAssets(pageAssets(html, page), 'https://cbctscope.com')).toEqual([
      'references https://va.example.com/script.js, which is not on https://cbctscope.com',
      'references https://cdn.example.net/x.js, which is not on https://cbctscope.com',
      'references http://cbctscope.com/c.css, which is not on https://cbctscope.com',
    ]);
  });

  it('passes the update page only when it names the version in package.json', () => {
    const page = `<main><p>${newestSentence('2.1.1')}</p></main>`;
    expect(versionProblem(page, '2.1.1')).toBeNull();
    expect(versionProblem(page, '2.2.0')).toBe('the update page does not say "The newest version of CBCTScope is 2.2.0."');
    expect(versionProblem(page.replace('2.1.1.', '2.1.10.'), '2.1.1')).toMatch(/does not say/);
    expect(versionProblem(page, '2.1.1-beta')).toBe('package.json\'s version "2.1.1-beta" is not major.minor.patch');
  });

  it('passes a response only from the deployment of the commit', () => {
    expect(commitProblem(SHA, SHA)).toBeNull();
    expect(commitProblem(null, SHA)).toBe(`X-CBCTScope-Commit is missing, expected ${SHA}`);
    expect(commitProblem('0'.repeat(40), SHA)).toBe(`X-CBCTScope-Commit is ${'0'.repeat(40)}, expected ${SHA}`);
  });

  it('reads its options: the public site by default, a deployment address with --base, the bypass secret from the environment only', () => {
    const def = liveOptions(['--live'], {});
    expect(def).toEqual({ base: 'https://cbctscope.com', commit: null, attempts: 3, headers: {}, publicSite: true, notes: [] });
    const preview = liveOptions(['--live', '--base', 'https://cbctscope-abc123-team.vercel.app/', '--commit', SHA, '--attempts', '1'], { VERCEL_AUTOMATION_BYPASS_SECRET: 's3cret' });
    expect(preview.base).toBe('https://cbctscope-abc123-team.vercel.app');
    expect(preview.commit).toBe(SHA);
    expect(preview.attempts).toBe(1);
    expect(preview.publicSite).toBe(false);
    expect(preview.headers).toEqual({ 'x-vercel-protection-bypass': 's3cret' });
    expect(preview.notes.join('\n')).toMatch(/is not the public site: the sitemap's https:\/\/cbctscope.com addresses are read as paths on it/);
    // the notes are printed: the secret is never in them
    expect(preview.notes.join('\n')).not.toContain('s3cret');
    expect(liveOptions(['--live', '--base', 'https://x.vercel.app'], {}).notes.join('\n')).toMatch(/no VERCEL_AUTOMATION_BYPASS_SECRET is set/);
    // never sent to the public site, www included
    for (const base of ['https://cbctscope.com', 'https://www.cbctscope.com']) {
      const o = liveOptions(['--live', '--base', base], { VERCEL_AUTOMATION_BYPASS_SECRET: 's3cret' });
      expect(o.headers, base).toEqual({});
      expect(o.publicSite, base).toBe(true);
      expect(o.notes, base).toEqual(['VERCEL_AUTOMATION_BYPASS_SECRET is set but not sent: the public site needs no bypass']);
    }
  });

  it('refuses any other argument, so no secret can come from the command line, and a malformed base or commit', () => {
    for (const args of [['--live', '--bypass', 'x'], ['--live', '--secret=x'], ['--live', 's3cret'], ['--live', '--out', 'out']]) {
      expect(() => liveOptions(args, {}), args.join(' ')).toThrow(/--live does not take/);
    }
    for (const base of ['http://cbctscope-x.vercel.app', 'https://x.vercel.app/manual/', 'https://x.vercel.app/?a=1', 'not a url']) {
      expect(() => liveOptions(['--live', '--base', base], {}), base).toThrow(/--base takes an https/);
    }
    expect(() => liveOptions(['--live', '--commit', 'main'], {})).toThrow(/--commit takes a full git SHA/);
    expect(() => liveOptions(['--live', '--base'], {})).toThrow(/--base needs a value/);
  });

  it('needs nothing installed: it imports only Node\'s modules and the repository\'s plain scripts', () => {
    const graph = ['scripts/site-check.mjs', 'scripts/sitemap.mjs', 'scripts/vercel-output.mjs', 'scripts/agent-frame.mjs', 'components/siteAddress.mjs', 'components/webCsp.mjs'];
    for (const f of graph) {
      for (const m of read(f).matchAll(/^import .* from '([^']+)';$/gm)) expect(m[1], f).toMatch(/^(node:|\.\.?\/)/);
    }
  });
});

describe('the byte check of an export on disk (scripts/site-check.mjs --base)', () => {
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
});

describe('the alarm after a deploy (site-check.yml)', () => {
  const job = alarm.jobs.live;
  const steps = job.steps ?? [];

  it('runs on Vercel\'s deployment_status events and by hand, with read-only permissions', () => {
    expect(alarm.on).toEqual({ deployment_status: null, workflow_dispatch: null });
    expect(alarm.permissions).toEqual({ contents: 'read' });
    expect(Object.keys(alarm.jobs)).toEqual(['live', 'failed']);
    expect(alarm.jobs.failed.permissions).toBeUndefined();
    expect(alarm.jobs.failed.environment).toBeUndefined();
    expect(job.permissions).toBeUndefined();
    expect(job.environment).toBeUndefined();
    expect(job['timeout-minutes']).toBe(15);
  });

  it('checks a successful production deployment only (or a run by hand), never a preview', () => {
    expect(job.if).toBe(
      "${{ github.event_name == 'workflow_dispatch' || (github.event.deployment_status.state == 'success' && startsWith(github.event.deployment.environment, 'Production')) }}",
    );
  });

  it('a failed or errored production deployment fails a job naming the commit', () => {
    const failed = alarm.jobs.failed;
    expect(failed.if).toBe(
      "${{ github.event_name == 'deployment_status' && (github.event.deployment_status.state == 'failure' || github.event.deployment_status.state == 'error') && startsWith(github.event.deployment.environment, 'Production') }}",
    );
    const [step] = failed.steps ?? [];
    expect(failed.steps).toHaveLength(1);
    expect(step.run).toContain('$COMMIT');
    expect(step.run).toContain('exit 1');
    expect(step.env).toEqual({ COMMIT: '${{ github.event.deployment.sha }}', STATE: '${{ github.event.deployment_status.state }}' });
  });

  it('a newer production check cancels a waiting one; every other run has a group of its own', () => {
    expect(alarm.concurrency?.['cancel-in-progress']).toBe(true);
    const group = alarm.concurrency?.group ?? '';
    // the condition that names the shared group is the live job's own condition, word for word
    const liveCondition = (alarm.jobs.live.if ?? '').replace(/^\$\{\{ | \}\}$/g, '');
    expect(group).toBe(`\${{ (${liveCondition}) && 'site-check-live' || format('site-check-{0}', github.run_id) }}`);
  });

  it('runs the live mode on the event\'s commit, with no install and no secret', () => {
    const runs = steps.map((s) => s.run).filter(Boolean);
    expect(runs).toEqual(['node scripts/site-check.mjs --live --commit "$COMMIT"']);
    expect(steps.find((s) => s.run)?.env).toEqual({ COMMIT: '${{ github.event.deployment.sha || github.sha }}' });
    // the checkout is the event's own commit: no ref of its own
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with).toBeUndefined();
    expect(read('.github/workflows/site-check.yml')).not.toMatch(/secrets\.|npm ci|npm install/);
  });

  it('every action in every workflow is pinned to a commit SHA', () => {
    for (const f of readdirSync(path.join(root, '.github/workflows'))) {
      for (const uses of read(`.github/workflows/${f}`).match(/uses: \S+/g) ?? []) expect(uses, f).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('the full suite still runs on every push to main and every pull request', () => {
    expect(ci.on).toEqual({ push: { branches: ['main'] }, pull_request: null });
    const runs = Object.values(ci.jobs).flatMap((j) => (j.steps ?? []).map((s) => s.run ?? ''));
    for (const cmd of ['npm run typecheck', 'npm run lint', 'npm test', 'npm run build', 'npm run build:web', 'npm run test:e2e']) expect(runs, cmd).toContain(cmd);
  });
});

// GitHub does not deploy the site. No file under .github/ may run the Vercel CLI, name a
// Vercel secret, run a job in a GitHub environment, or name a production or rehearsal
// environment. The word "Production" is allowed only where the alarm tests the environment
// Vercel reports its deployment under: its two jobs' conditions and its concurrency group. Every string value and key is read; comments
// are not.
const VERCEL_SECRET = /VERCEL_(TOKEN|ORG_ID|PROJECT_ID|AUTOMATION_BYPASS_SECRET)/;
const VERCEL_CLI = /\bvercel\s+(deploy|build|pull|promote|alias|link|env)\b|--prebuilt\b|--prod\b/i;
const ENVIRONMENT_WORD = /\b(production|rehearsal)\b/i;
const ALLOWED = { file: '.github/workflows/site-check.yml', where: ['.jobs.live.if', '.jobs.failed.if', '.concurrency.group'] };

/** what in a parsed YAML file deploys, reaches a Vercel secret, or names a GitHub environment */
export function deployProblems(doc: unknown, file = ''): string[] {
  const problems: string[] = [];
  const walk = (node: unknown, where: string) => {
    if (typeof node === 'string') {
      if (VERCEL_CLI.test(node)) problems.push(`${where}: runs the Vercel CLI in "${node}"`);
      if (VERCEL_SECRET.test(node)) problems.push(`${where}: a Vercel secret in "${node}"`);
      if (ENVIRONMENT_WORD.test(node) && !(file === ALLOWED.file && ALLOWED.where.includes(where))) problems.push(`${where}: names an environment in "${node}"`);
      return;
    }
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}[${i}]`));
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'environment') problems.push(`${where}.environment: a job in a GitHub environment`);
      if (VERCEL_SECRET.test(k)) problems.push(`${where}.${k}: a Vercel secret's name as a key`);
      walk(v, `${where}.${k}`);
    }
  };
  walk(doc, '');
  return problems;
}

describe('no workflow deploys the site or can reach a Vercel secret', () => {
  const yamlFiles = (dir: string): string[] =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? yamlFiles(`${dir}/${e.name}`) : /\.ya?ml$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );
  const all = yamlFiles('.github');

  it('reads every YAML file under .github/: the four workflows and Dependabot', () => {
    expect(all.sort()).toEqual(['.github/dependabot.yml', '.github/workflows/ci.yml', '.github/workflows/codeql.yml', '.github/workflows/release.yml', '.github/workflows/site-check.yml']);
  });

  it('none runs the Vercel CLI, names a Vercel secret, runs in a GitHub environment, or names production or rehearsal', () => {
    for (const f of all) expect(deployProblems(yaml.load(read(f)), f), f).toEqual([]);
    for (const f of all) expect(read(f), f).not.toMatch(/deploy\//);
  });

  it('the deploy tool is gone: no deploy/ folder, no vercel package, nothing for Dependabot to watch there', () => {
    expect(existsSync(path.join(root, 'deploy'))).toBe(false);
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('vercel');
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, unknown> };
    expect(lock.packages).not.toHaveProperty('node_modules/vercel');
    const dependabot = yaml.load(read('.github/dependabot.yml')) as { updates: { directories?: string[] }[] };
    expect(dependabot.updates.flatMap((u) => u.directories ?? [])).toEqual(['/', '/mcp']);
  });

  it('the check finds each form, so it does not pass by finding nothing', () => {
    const mutate = (edit: (wf: Workflow) => void, file = '.github/workflows/ci.yml') => {
      const wf = yaml.load(read(file)) as Workflow;
      edit(wf);
      return deployProblems(wf, file);
    };
    const step = (wf: Workflow, s: Step) => wf.jobs.build.steps?.push(s);
    expect(mutate((wf) => (wf.jobs.build.environment = 'staging'))).toEqual(['.jobs.build.environment: a job in a GitHub environment']);
    expect(mutate((wf) => (wf.jobs.build.environment = { name: 'production', url: 'https://cbctscope.com' }))).toEqual([
      '.jobs.build.environment: a job in a GitHub environment',
      '.jobs.build.environment.name: names an environment in "production"',
    ]);
    for (const run of ['npx vercel deploy', 'vercel build --prod', 'vercel deploy --prebuilt', 'node_modules/.bin/vercel pull --yes']) {
      expect(mutate((wf) => step(wf, { run })), run).toEqual([expect.stringMatching(/runs the Vercel CLI/)]);
    }
    expect(mutate((wf) => step(wf, { run: 'x', env: { T: '${{ secrets.VERCEL_TOKEN }}' } }))).toEqual([expect.stringMatching(/a Vercel secret in/)]);
    expect(mutate((wf) => ((wf as unknown as { env: unknown }).env = { VERCEL_ORG_ID: 'x' }))).toEqual([expect.stringMatching(/a Vercel secret's name as a key/)]);
    expect(mutate((wf) => step(wf, { run: 'echo rehearsal' }))).toEqual([expect.stringMatching(/names an environment/)]);
    // the allowance is for the alarm's own condition only
    expect(mutate((wf) => (wf.jobs.live.steps![0].name = 'Production'), ALLOWED.file)).toEqual([expect.stringMatching(/names an environment/)]);
    expect(mutate(() => {}, ALLOWED.file)).toEqual([]);
    expect(deployProblems(alarm, 'elsewhere.yml')).toEqual([
      expect.stringMatching(/^\.concurrency\.group: names an environment/),
      expect.stringMatching(/^\.jobs\.live\.if: names an environment/),
      expect.stringMatching(/^\.jobs\.failed\.if: names an environment/),
    ]);
    // a file without jobs, like Dependabot's, is read too
    expect(deployProblems({ updates: [{ registries: ['${{ secrets.VERCEL_TOKEN }}'] }] })).toEqual([expect.stringMatching(/a Vercel secret/)]);
  });
});
