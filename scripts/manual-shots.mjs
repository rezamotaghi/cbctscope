// Manual stills for docs/media/manual/, captured from the running viewer in a headless Chrome
// over the DevTools protocol. No dependencies (Node 22 has fetch and WebSocket).
//
//   node scripts/manual-shots.mjs <plan...> [--params file.json] [--out docs/media/manual] [--url http://localhost:3810/] [--reload]
//
// Plans: header (the phantom with numbered callouts: run against `npm run demo`, nothing opened),
// mpr, grid, pano, tmj, reslice, ceph, region, stitch, or `modes` for all eight (run against
// `npm run dev` with the volume to show restored; demo mode drops an opened source on every
// recompile). Each still is written as WebP at 1600 by 913 CSS pixels, device scale 2.
//
// The params file supplies what a still needs on a given volume (slice indices in the buffer's
// z index, coordinates in CSS pixels of the 1600 by 913 viewport, window presets); without it a
// plan only enters the mode and shoots. The file for the consented volume that the manual uses
// lives beside that volume, outside the repo (docs/manual/README.md). Keys per plan:
//   anon: volume id the persisted arch, lines, and path are keyed under (localStorage); label: header text to wait for
//   mpr: { slice, click: [x, y] }            grid: { slice }
//   pano: { archFile | arch, preset }        tmj: { z, lines: [[x1,y1,x2,y2], ...], sync, preset }
//   reslice: { z, stroke: [[x,y], ...], vcrop: [[x,y1,y2], [x,y1,y2]], preset }
//   region: { slider: [x,y1,y2], box: [x1,y1,x2,y2], seed: [x,y], preset }   ceph, stitch: {}
//
// Chrome: the CHROME env var, else the Playwright chromium under ~/Library/Caches/ms-playwright.
// Hardware WebGL is required (the software renderer cannot hold a full CBCT texture), so the
// headless flags leave the GPU on. A verb goes to the newest viewer tab: keep other tabs closed.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const plans = args.filter((a, i) => !a.startsWith('--') && !['--params', '--out', '--url'].includes(args[i - 1]));
const URL_ = opt('--url', 'http://localhost:3810/');
const OUT = opt('--out', 'docs/media/manual');
const P = opt('--params', null) ? JSON.parse(readFileSync(opt('--params'), 'utf8')) : {};
const W = 1600, H = 913, PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright');
  if (!existsSync(cache)) throw new Error('no Chrome: set CHROME to a Chrome/Chromium binary');
  const dirs = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse();
  for (const d of dirs) {
    const bin = path.join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
    if (existsSync(bin)) return bin;
  }
  throw new Error('no Chrome: set CHROME to a Chrome/Chromium binary');
}

async function alive() { try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; } }

async function launch() {
  if (await alive()) return;
  const child = spawn(findChrome(), [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(tmpdir(), 'cbctscope-manual-shots')}`,
    `--window-size=${W},${H}`, '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore', detached: true });
  child.unref();
  for (let i = 0; i < 100; i++) { if (await alive()) return; await sleep(100); }
  throw new Error('Chrome did not start');
}

async function page() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let t = list.find((x) => x.type === 'page' && x.url.startsWith(URL_));
  if (!t) t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL_)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); const p = d.id && pending.get(d.id); if (!p) return; pending.delete(d.id); if (d.error) p.rej(new Error(`${p.method}: ${d.error.message}`)); else p.res(d.result); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej, method }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });
  const click = async (x, y, count = 1) => { await mouse('mouseMoved', x, y, { button: 'none' }); for (let c = 1; c <= count; c++) { await mouse('mousePressed', x, y, { clickCount: c }); await sleep(30); await mouse('mouseReleased', x, y, { clickCount: c }); await sleep(60); } };
  const stroke = async (pts, steps = 10) => { await mouse('mouseMoved', pts[0][0], pts[0][1], { button: 'none' }); await mouse('mousePressed', pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) { const [x1, y1] = pts[k - 1], [x2, y2] = pts[k]; for (let s = 1; s <= steps; s++) { await mouse('mouseMoved', x1 + ((x2 - x1) * s) / steps, y1 + ((y2 - y1) * s) / steps); await sleep(16); } } const [lx, ly] = pts[pts.length - 1]; await mouse('mouseReleased', lx, ly); };
  const drag = (x1, y1, x2, y2) => stroke([[x1, y1], [x2, y2]]);
  const clickText = async (selector, text) => { const r = await evaluate(`(() => { const els = Array.from(document.querySelectorAll(${JSON.stringify(selector)})); const el = els.find(e => (e.innerText || '').trim() === ${JSON.stringify(text)}) || els.find(e => (e.innerText || '').trim().startsWith(${JSON.stringify(text)})); if (!el) return null; const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`); if (!r) throw new Error(`no ${selector} "${text}"`); await click(r[0], r[1]); await sleep(300); };
  const shot = async (name, height = H) => { await send('Emulation.setDeviceMetricsOverride', { width: W, height, deviceScaleFactor: 2, mobile: false }); await sleep(400); const r = await send('Page.captureScreenshot', { format: 'webp', quality: 82 }); await mkdir(OUT, { recursive: true }); const f = path.join(OUT, name + '.webp'); await writeFile(f, Buffer.from(r.data, 'base64')); console.log('wrote', f); return f; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  return { send, evaluate, click, stroke, drag, clickText, shot, close: () => ws.close() };
}

const verb = async (v, a = {}) => {
  // a mode that has just mounted answers "not loaded yet" for a moment; wait it out
  for (let attempt = 0; ; attempt++) {
    const d = await (await fetch(URL_ + 'api/agent/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verb: v, args: a, timeoutMs: 30000 }) })).json();
    if (d.ok) return d;
    if (attempt < 20 && /not loaded yet|not ready/.test(String(d.error))) { await sleep(500); continue; }
    throw new Error(`${v}: ${d.error}`);
  }
};

await launch();
const p = await page();
const header = () => p.evaluate("document.querySelector('header') ? document.querySelector('header').innerText : ''");
// --reload: start from a fresh page load (after a server restart the attached page is stale);
// params.label: the volume label to wait for in the header, else any loaded image (µm in the image line)
if (args.includes('--reload')) await p.send('Page.navigate', { url: URL_ });
const wanted = P.label ? new RegExp(P.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' · ') : /µm/;
for (let i = 0; i < 240; i++) { if (wanted.test(await header())) break; await sleep(500); }
await sleep(2000);
const mode = async (m) => { await verb('set_view_mode', { mode: m }); await sleep(1500); };
const preset = async (name) => { if (name) { await verb('set_window_level', { preset: name }); await sleep(500); } };
const KEYS = { tmj: 'cbctscope-tmj:v1:', reslice: 'cbctscope-reslice:v1:' };
/** set a mode's persisted scout slice (buffer z) and re-enter the mode so it reloads */
const setZ = async (m, z, extra) => { const key = KEYS[m] + P.anon; await p.evaluate(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify({ ...extra, z }))}); 'ok'`); await mode('mpr'); await mode(m); await sleep(2500); };

const PLANS = {
  async header() {
    // callouts numbered as in docs/manual/03-interface.md, on the header's children in DOM order
    const groups = [[0, 1], [2], [3], [4, 5, 6], [7], [8], [9], [13], [14], [10], [12]];
    // a fresh load: the still shows the first-run state (phantom named, hint on the image line)
    await p.send('Page.navigate', { url: URL_ });
    for (let i = 0; i < 120; i++) { if (/Synthetic phantom/.test(await header())) break; await sleep(500); }
    await sleep(3000); await mode('mpr');
    await p.evaluate(`(() => { const c = Array.from(document.querySelector('header').children); document.querySelectorAll('.doc-callout').forEach(e => e.remove()); ${JSON.stringify(groups)}.forEach((idxs, n) => { const rs = idxs.map(i => c[i].getBoundingClientRect()); const left = Math.max(2, Math.min(...rs.map(r => r.left)) - 10), top = Math.max(2, Math.min(...rs.map(r => r.top)) - 10); const el = document.createElement('div'); el.className = 'doc-callout'; el.textContent = String(n + 1); Object.assign(el.style, { position: 'fixed', left: left + 'px', top: top + 'px', width: '18px', height: '18px', borderRadius: '50%', background: '#e0b341', color: '#000', font: 'bold 11px/18px system-ui, sans-serif', textAlign: 'center', zIndex: 9999, boxShadow: '0 0 0 1.5px #000' }); document.body.appendChild(el); }); return document.querySelector('header').getBoundingClientRect().height; })()`);
    const h = await p.evaluate("document.querySelector('header').getBoundingClientRect().height");
    await p.shot('header', Math.ceil(h) + 2);
    await p.evaluate("document.querySelectorAll('.doc-callout').forEach(e => e.remove()); 0");
  },
  async mpr() {
    const c = P.mpr || {}; await mode('mpr'); await verb('reset_view', { full: true });
    if (c.slice) await verb('navigate_slice', { pane: 'axial', index: c.slice });
    await sleep(1500); if (c.click) await p.click(...c.click); await sleep(2500); await p.shot('mode-mpr');
  },
  async grid() { const c = P.grid || {}; await mode('grid'); if (c.slice) await verb('navigate_slice', { pane: 'axial', index: c.slice }); await sleep(3000); await p.shot('mode-grid'); },
  async pano() {
    const c = P.pano || {}; const arch = c.arch || (c.archFile ? JSON.parse(readFileSync(c.archFile, 'utf8')) : null);
    if (arch) await p.evaluate(`localStorage.setItem('cbctscope-arch:v1:${P.anon}', ${JSON.stringify(JSON.stringify(arch))}); 'ok'`);
    await mode('mpr'); await mode('pano'); await preset(c.preset); await sleep(6000); await p.shot('mode-pano');
  },
  async tmj() {
    const c = P.tmj || {}; await preset(c.preset);
    if (c.z) { await setZ('tmj', c.z, { lines: {} }); if (c.sync) await p.clickText('label, span', 'sync sides'); for (const l of c.lines || []) { await p.drag(...l); await sleep(800); } } else await mode('tmj');
    await sleep(3000); await p.shot('mode-tmj');
  },
  async reslice() {
    const c = P.reslice || {}; await preset(c.preset);
    if (c.z) { await setZ('reslice', c.z, { points: [], done: false }); if (c.stroke) { await p.stroke(c.stroke); await sleep(400); await p.click(...c.stroke[c.stroke.length - 1], 2); await sleep(2500); } for (const [x, y1, y2] of c.vcrop || []) { await p.drag(x, y1, x, y2); await sleep(800); } } else await mode('reslice');
    await sleep(2500); await p.shot('mode-reslice');
  },
  async ceph() {
    // densest-only MIP: no soft-tissue profile is projected (AGENTS.md hard rule 3)
    await mode('ceph'); await sleep(1500); await p.clickText('label, span', 'MIP'); await p.clickText('button', 'auto contrast'); await sleep(4000); await p.shot('mode-ceph');
  },
  async region() {
    const c = P.region || {}; await preset(c.preset); await mode('region'); await sleep(1500); await p.clickText('button', 'air'); await sleep(300);
    if (c.slider) { const [x, y1, y2] = c.slider; await p.drag(x, y1, x, y2); await sleep(2000); }
    if (c.box) { await p.drag(...c.box); await sleep(500); } if (c.seed) { await p.click(...c.seed); await sleep(6000); }
    await p.shot('mode-region');
  },
  async stitch() { await preset('Auto'); await mode('stitch'); await sleep(2500); await p.shot('mode-stitch'); },
};
PLANS.modes = async () => { for (const m of ['mpr', 'grid', 'pano', 'tmj', 'reslice', 'ceph', 'region', 'stitch']) await PLANS[m](); };

if (!plans.length) { console.error('usage: node scripts/manual-shots.mjs <plan...> [--params file.json] [--out dir] [--url url]; plans: ' + Object.keys(PLANS).join(', ')); process.exit(2); }
for (const name of plans) { if (!PLANS[name]) throw new Error('unknown plan ' + name); await PLANS[name](); }
p.close();
