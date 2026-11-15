#!/usr/bin/env node
// The agent frame page, agent-frame.html (docs/web-build.md section 2): the in-page agent's
// provider adapters, the key and the fetch loop, bundled from components/cbct/agent/frame/main.ts
// into one inline script, with a Content Security Policy meta tag of its own
// (components/webCsp.mjs agentFrameCsp: the provider hosts and loopback, the script by hash).
// scripts/build-web.mjs writes it into the export like every other page; the viewer loads it in
// an <iframe sandbox="allow-scripts">. Inline on purpose: a sandboxed frame has an opaque origin,
// so a separate script file would be a cross-site request the desktop bridge refuses.
//
//   node scripts/agent-frame.mjs <out-dir>    write <out-dir>/agent-frame.html
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { agentFrameCsp } from '../components/webCsp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AGENT_FRAME_FILE = 'agent-frame.html';
const ENTRY = path.join(root, 'components', 'cbct', 'agent', 'frame', 'main.ts');

const encode = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

/** the frame's script, one IIFE; `</` is escaped so the HTML parser never ends the element early */
export async function bundleAgentFrame() {
  const bundle = await rolldown({
    input: ENTRY,
    resolve: { alias: { '@': root } },
    platform: 'browser',
    logLevel: 'warn',
  });
  try {
    const { output } = await bundle.generate({ format: 'iife', minify: true });
    return output[0].code.replace(/<\//g, '<\\/');
  } finally {
    await bundle.close();
  }
}

/** the whole page and the hash source of its script */
export async function buildAgentFrameHtml() {
  const code = await bundleAgentFrame();
  const hash = `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`;
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${encode(agentFrameCsp([hash]))}">` +
    '<meta name="referrer" content="no-referrer"><title>CBCTScope agent frame</title></head>' +
    `<body><script>${code}</script></body></html>\n`;
  return { html, hash };
}

export async function writeAgentFrame(outDir) {
  const { html } = await buildAgentFrameHtml();
  writeFileSync(path.join(outDir, AGENT_FRAME_FILE), html);
  return html.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: node scripts/agent-frame.mjs <out-dir>');
    process.exit(2);
  }
  const bytes = await writeAgentFrame(path.resolve(root, out));
  console.log(`agent-frame: ${out}/${AGENT_FRAME_FILE}, ${bytes} bytes`);
}
