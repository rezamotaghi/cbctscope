#!/usr/bin/env node
// npm run test:e2e: the web build's end-to-end suite (docs/web-build.md, section 8).
// Expects out/ from `npm run build:web`. Builds the low-threshold variant (size notice at
// 1 MiB, so the phantom trips it) into out-small/ and the base-path variant (/cbctscope, the
// support for serving the site from a sub-path) into out-base/, then runs Playwright against
// all three.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(root, 'out', 'index.html'))) {
  console.error('test:e2e: out/ is missing; run npm run build:web first');
  process.exit(1);
}

const step = (label, args, env = process.env) => {
  console.log(`\ntest:e2e: ${label}`);
  const r = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

step('low-threshold build into out-small/', [path.join(root, 'scripts/build-web.mjs'), '--out', 'out-small'], {
  ...process.env,
  NEXT_PUBLIC_CBCTSCOPE_SIZE_NOTICE_MIB: '1',
  NEXT_PUBLIC_BASE_PATH: '',
});
step('base-path build into out-base/', [path.join(root, 'scripts/build-web.mjs'), '--out', 'out-base'], {
  ...process.env,
  NEXT_PUBLIC_BASE_PATH: '/cbctscope',
});
const playwright = createRequire(import.meta.url).resolve('@playwright/test/cli');
step('playwright', [playwright, 'test', ...process.argv.slice(2)]);
