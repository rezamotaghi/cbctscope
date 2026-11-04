#!/usr/bin/env node
// Build the MCP Bundle (.mcpb) of the agent server for one-click install into Claude
// Desktop: stage mcp/ (server, package.json, manifest.json) into .mcpb/ together with the
// shared verb module (lib/shared/verbs.mjs, staged as verbs.mjs beside the server, whose
// import is rewritten to match; the bundle is flat), install its
// production dependencies there (a bundle must carry its own node_modules), validate the
// manifest, pack to dist/cbctscope-<version>.mcpb. Both folders are gitignored; the
// bundle is attached to the GitHub release by hand.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, '.mcpb');
const dist = path.join(root, 'dist');
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const mcpb = path.join(root, 'node_modules', '.bin', 'mcpb');

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(dist, { recursive: true });
for (const f of ['package.json', 'manifest.json']) cpSync(path.join(root, 'mcp', f), path.join(stage, f));
const VERBS_IMPORT = "from '../lib/shared/verbs.mjs'";
const server = readFileSync(path.join(root, 'mcp', 'server.mjs'), 'utf8');
if (!server.includes(VERBS_IMPORT)) throw new Error(`mcp/server.mjs no longer imports ${VERBS_IMPORT}: update scripts/mcpb.mjs`);
writeFileSync(path.join(stage, 'server.mjs'), server.replace(VERBS_IMPORT, "from './verbs.mjs'"));
cpSync(path.join(root, 'lib', 'shared', 'verbs.mjs'), path.join(stage, 'verbs.mjs'));
cpSync(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));

execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, stdio: 'inherit' });
execFileSync(mcpb, ['validate', path.join(stage, 'manifest.json')], { stdio: 'inherit' });
const out = path.join(dist, `cbctscope-${version}.mcpb`);
execFileSync(mcpb, ['pack', stage, out], { stdio: 'inherit' });
console.log(`\nbundle: ${out}`);
