#!/usr/bin/env node
// npm run desktop / npm run desktop:build: the desktop app (docs/web-build.md, section 12).
//
//   node scripts/desktop.mjs dev     start Electron on desktop/main.mjs against out/
//   node scripts/desktop.mjs build   package with electron-builder (electron-builder.yml)
//
// Both build the web target first when out/ is missing (a stale out/ is used as is: run
// `npm run build:web` after a viewer change).
//
// Signing and notarisation, driven by the environment only (electron-builder 26.18.0):
//   - signing: a Developer ID Application identity in the keychain, or CSC_LINK (the .p12,
//     a path or base64) plus CSC_KEY_PASSWORD. CSC_IDENTITY_AUTO_DISCOVERY=false builds unsigned.
//   - notarisation: APPLE_KEYCHAIN_PROFILE (a `xcrun notarytool store-credentials` profile),
//     or APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER (CI), or APPLE_ID +
//     APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID. A signed local build with none of them set
//     uses the keychain profile named `notary`.
//   - the dmg: electron-builder signs it (dmg.sign) and notarises only the app inside, so each
//     dmg built here is then submitted, stapled and validated with the same credentials
//     (scripts/desktop-notarize.mjs). An unsigned build skips that with one line.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notariseDmgs } from './desktop-notarize.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'build') {
  console.error('usage: node scripts/desktop.mjs dev|build [electron-builder args]');
  process.exit(2);
}
const require = createRequire(import.meta.url);

const run = (args, env = process.env) => {
  const r = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!existsSync(path.join(root, 'out', 'index.html'))) {
  console.log('desktop: out/ is missing, building the web target first');
  // the app serves from the root of its own origin: no base path
  run([path.join(root, 'scripts', 'build-web.mjs')], { ...process.env, NEXT_PUBLIC_BASE_PATH: '' });
}

if (mode === 'dev') {
  // the electron package's main export is the path of its binary
  const electron = require('electron');
  const r = spawnSync(electron, [root], { cwd: root, stdio: 'inherit' });
  process.exit(r.status ?? 0);
}

const env = { ...process.env };
const notaryCreds = ['APPLE_KEYCHAIN_PROFILE', 'APPLE_API_KEY', 'APPLE_ID'].some((k) => env[k]);
if (process.platform === 'darwin' && env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false' && !notaryCreds) {
  env.APPLE_KEYCHAIN_PROFILE = 'notary';
}
const builder = require.resolve('electron-builder/cli.js');
const started = Date.now();
run([builder, ...process.argv.slice(3)], env);
const outDir = path.join(root, 'dist-desktop');
const dmgs = existsSync(outDir)
  ? readdirSync(outDir)
      .filter((f) => f.endsWith('.dmg'))
      .map((f) => path.join(outDir, f))
      .filter((f) => statSync(f).mtimeMs >= started)
  : [];
try {
  notariseDmgs(dmgs, env);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
console.log(`desktop: packaged in ${((Date.now() - started) / 1000).toFixed(1)} s, output in dist-desktop/`);
