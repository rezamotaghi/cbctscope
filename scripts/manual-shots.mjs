// Manual stills for docs/media/manual/, captured from the running viewer in a headless Chrome
// over the DevTools protocol. No dependencies (Node 22 has fetch and WebSocket).
//
//   node scripts/manual-shots.mjs <plan...> [--params file.json] [--out docs/media/manual] [--url http://localhost:3810/] [--reload]
//   node scripts/manual-shots.mjs measure     prints the visible pane rectangles of the current mode
//
// Plans: header (the phantom with numbered callouts: run against `npm run demo`, nothing opened),
// mpr, grid, pano, tmj, reslice, ceph, region, stitch, or `modes` for all eight (run against
// `npm run dev` with the volume to show opened; demo mode drops an opened source on every
// recompile). Each still is written as WebP at 1600 by 913 CSS pixels, device scale 2.
//
// The params file supplies what a still needs on a given volume; without it a plan only enters
// the mode and shoots. The file for the consented volume that the manual uses lives beside that
// volume, outside the repo (docs/manual/README.md). Nothing in it is a screen coordinate, so a
// change of layout needs no recalibration:
//   - a slice level is the pane's own 1-based count, as the pane label prints it ("AXIAL 435/801"
//     is 435). An axial scout (Pano, TMJ, Reslice, Region) opens on the MPR axial level, so a
//     plan sets that level in MPR and then enters its mode.
//   - a point on an image is { pane, img: [fx, fy] }: pane is the index of the visible canvas in
//     the mode area in DOM order (`measure` lists them; the axial scout is 0), and fx, fy are
//     fractions of the image as drawn in that canvas (left/top 0, right/bottom 1).
// Keys per plan:
//   anon: the volume id (selected on start; the persisted arch, lines and path are keyed under it)
//   label: the case label to wait for in the status line
//   mpr: { axial, sagittal, coronal, style3d, threshold3d }     grid: { axial }
//   pano: { axial, archFile | arch, preset }                    tmj: { axial, lines: [[p, p], ...], sync, preset }
//   reslice: { axial, stroke: [p, ...], vrange: [lo%, hi%], preset }
//   region: { axial, box: [p, p], seed: p, preset }            ceph, stitch: {}
//
// Chrome: the CHROME env var, else the Playwright chromium under ~/Library/Caches/ms-playwright.
// Hardware WebGL is required (the software renderer cannot hold a full CBCT texture), so the
// headless flags leave the GPU on. It runs incognito with the HTTP cache off: no state carries
// from one run to the next (the plans seed what they need), and on macOS 27 a profile's disk
// cache stalled every request of a fresh headless Chrome. A verb goes to the newest viewer tab:
// keep other tabs closed.
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
    `--window-size=${W},${H}`, '--ignore-gpu-blocklist', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--incognito', '--disable-http-cache', URL_,
  ], { stdio: 'ignore', detached: true });
  child.unref();
  for (let i = 0; i < 100; i++) { if (await alive()) return; await sleep(100); }
  throw new Error('Chrome did not start');
}

async function page() {
  let t;
  for (let i = 0; i < 50 && !t; i++) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    t = list.find((x) => x.type === 'page' && x.url.startsWith(URL_));
    if (!t) await sleep(100);
  }
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
  // a still shorter than the viewport is a clip of the full layout: shrinking the viewport instead
  // would squeeze the panes under the header and push their overlays up into it
  const shot = async (name, height = H) => { await sleep(400); const r = await send('Page.captureScreenshot', { format: 'webp', quality: 82, ...(height < H ? { clip: { x: 0, y: 0, width: W, height, scale: 1 } } : {}) }); await mkdir(OUT, { recursive: true }); const f = path.join(OUT, name + '.webp'); await writeFile(f, Buffer.from(r.data, 'base64')); console.log('wrote', f); return f; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  return { send, evaluate, click, stroke, drag, clickText, shot, close: () => ws.close() };
}

const verb = async (v, a = {}) => {
  // a mode that has just mounted answers "not loaded yet" for a moment; wait it out
  for (let attempt = 0; ; attempt++) {
    const d = await (await fetch(URL_ + 'api/agent/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verb: v, args: a, timeoutMs: 30000 }) })).json();
    if (d.ok) return d;
    if (attempt < 20 && /not loaded yet|not ready|no viewer/.test(String(d.error))) { await sleep(500); continue; }
    throw new Error(`${v}: ${d.error}`);
  }
};

await launch();
const p = await page();
const status = () => p.evaluate("document.querySelector('[data-testid=status-line]')?.innerText ?? ''");
// --reload: start from a fresh page load (after a server restart the attached page is stale)
if (args.includes('--reload')) await p.send('Page.navigate', { url: URL_ });

/** the visible canvases of the mode area in DOM order: element rect plus the drawn image (the bitmap contained in it) */
const panes = () => p.evaluate(`Array.from(document.querySelectorAll('main canvas')).map((c) => { const r = c.getBoundingClientRect(); const s = c.width && c.height ? Math.min(r.width / c.width, r.height / c.height) : 0; const iw = c.width * s, ih = c.height * s; return { x: r.left, y: r.top, w: r.width, h: r.height, img: { x: r.left + (r.width - iw) / 2, y: r.top + (r.height - ih) / 2, w: iw, h: ih } }; }).filter((r) => r.w > 0 && r.h > 0)`);
/** a params point in CSS pixels: { pane, img: [fx, fy] }, or [x, y] taken as it is */
const at = async (pt) => { if (Array.isArray(pt)) return pt; const r = (await panes())[pt.pane]; if (!r) throw new Error('no pane ' + pt.pane); return [r.img.x + pt.img[0] * r.img.w, r.img.y + pt.img[1] * r.img.h]; };
/** set a range input found by the start of its label or title text, the way a drag would (React sees an input event) */
const setRange = (text, value) => p.evaluate(`(() => { const t = ${JSON.stringify(text)}; const el = Array.from(document.querySelectorAll('input[type=range]')).find((e) => (e.title || '').startsWith(t) || (e.closest('label')?.innerText || '').trim().startsWith(t)); if (!el) throw new Error('no slider ' + t); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(${Number(value)})); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);
const setCheck = (text, on) => p.evaluate(`(() => { const l = Array.from(document.querySelectorAll('label')).find((e) => e.innerText.trim().startsWith(${JSON.stringify(text)})); const box = l?.querySelector('input[type=checkbox]'); if (!box) throw new Error('no checkbox ' + ${JSON.stringify(text)}); if (box.checked !== ${!!on}) box.click(); return box.checked; })()`);

if (plans[0] === 'measure') {
  console.log(JSON.stringify((await panes()).map((r, i) => ({ pane: i, rect: [r.x, r.y, r.w, r.h].map(Math.round), img: [r.img.x, r.img.y, r.img.w, r.img.h].map(Math.round) }))));
  p.close();
  process.exit(0);
}

// wait for the page, then show the params' volume: params.label is the case label the status line leads with
for (let i = 0; i < 240; i++) { if (/µm/.test(await status())) break; await sleep(500); }
if (P.anon && !plans.every((n) => n === 'header')) {
  await verb('select_volume', { id: P.anon });
  const wanted = new RegExp('^' + (P.label || P.anon).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' · ');
  for (let i = 0; i < 240; i++) { if (wanted.test(await status())) break; await sleep(500); }
}
await sleep(2000);
const mode = async (m) => { await verb('set_view_mode', { mode: m }); await sleep(1500); };
const preset = async (name) => { if (name) { await verb('set_window_level', { preset: name }); await sleep(500); } };
/** put the MPR axial pane on a level (the pane's 1-based count), then enter the mode: its axial scout opens there */
const level = async (m, axial) => { await mode('mpr'); if (axial) { await verb('navigate_slice', { pane: 'axial', index: axial - 1 }); await sleep(800); } await mode(m); await sleep(2500); };
const KEYS = { tmj: 'cbctscope-tmj:v1:', reslice: 'cbctscope-reslice:v1:', arch: 'cbctscope-arch:v1:' };
const store = (key, value) => p.evaluate(`localStorage.setItem(${JSON.stringify(key + P.anon)}, ${JSON.stringify(JSON.stringify(value))}); 'ok'`);

const PLANS = {
  async header() {
    // callouts numbered as in docs/manual/03-interface.md, section 3.1; a control the build does
    // not show (Agent and the desktop download are website and desktop-app only) keeps its number
    const targets = [
      "header strong",
      "header [title^='This viewer is research software']",
      "header .tabs",
      "header .hgroup-volume",
      ['button', 'Open'], ['button', 'Export'], ['button', 'Snapshot'], ['button', 'Keys'], ['button', 'Help'],
      ['button', 'Agent'], ['a', 'Download the desktop app'],
    ];
    // a fresh load: the still shows the first-run state (the phantom, the first-run line)
    await p.send('Page.navigate', { url: URL_ });
    for (let i = 0; i < 120; i++) { if (/no patient data/.test(await status())) break; await sleep(500); }
    await sleep(3000); await mode('mpr');
    // the header gains 14 px of top padding for the still only, so each callout sits above its
    // control's top-left corner instead of covering the label
    await p.evaluate(`(() => { const hdr = document.querySelector('header'); hdr.dataset.docPad = hdr.style.paddingTop; hdr.style.paddingTop = (parseFloat(getComputedStyle(hdr).paddingTop) + 14) + 'px'; return 0; })()`);
    await sleep(500);
    await p.evaluate(`(() => { document.querySelectorAll('.doc-callout').forEach(e => e.remove()); const find = (t) => { if (typeof t === 'string') { const el = document.querySelector(t); return t === 'header strong' ? el?.parentElement?.parentElement : el; } return Array.from(document.querySelectorAll('header ' + t[0])).find((e) => (e.innerText || '').trim().startsWith(t[1])); }; ${JSON.stringify(targets)}.forEach((t, n) => { const target = find(t); if (!target) return; const r = target.getBoundingClientRect(); const el = document.createElement('div'); el.className = 'doc-callout'; el.textContent = String(n + 1); Object.assign(el.style, { position: 'fixed', left: Math.max(1, r.left - 4) + 'px', top: Math.max(1, r.top - 17) + 'px', width: '16px', height: '16px', borderRadius: '50%', background: '#e0b341', color: '#000', font: 'bold 10px/16px system-ui, sans-serif', textAlign: 'center', zIndex: 9999, boxShadow: '0 0 0 1.5px #000' }); document.body.appendChild(el); }); return 0; })()`);
    const h = await p.evaluate("document.querySelector('header').getBoundingClientRect().height");
    await p.shot('header', Math.ceil(h) + 2);
    await p.evaluate("document.querySelectorAll('.doc-callout').forEach(e => e.remove()); const hdr = document.querySelector('header'); hdr.style.paddingTop = hdr.dataset.docPad || ''; 0");
  },
  async mpr() {
    // the 3D pane is the bone Surface render, never soft tissue (AGENTS.md hard rule 3)
    const c = P.mpr || {}; await mode('mpr'); await verb('reset_view', { full: true });
    await verb('set_3d_style', { style: c.style3d || 'style:surface' }); await sleep(500);
    if (c.threshold3d) await setRange('Cut-off threshold', c.threshold3d);
    for (const pane of ['axial', 'sagittal', 'coronal']) if (c[pane]) { await verb('navigate_slice', { pane, index: c[pane] - 1 }); await sleep(500); }
    await sleep(4000); await p.shot('mode-mpr');
  },
  async grid() { const c = P.grid || {}; await mode('grid'); if (c.axial) await verb('navigate_slice', { pane: 'axial', index: c.axial - 1 }); await sleep(3000); await p.shot('mode-grid'); },
  async pano() {
    const c = P.pano || {}; const arch = c.arch || (c.archFile ? JSON.parse(readFileSync(c.archFile, 'utf8')) : null);
    if (arch) await store(KEYS.arch, arch);
    await level('pano', c.axial); await preset(c.preset); await sleep(6000); await p.shot('mode-pano');
  },
  async tmj() {
    const c = P.tmj || {}; await preset(c.preset);
    await store(KEYS.tmj, { lines: {} }); await level('tmj', c.axial);
    if (c.sync !== undefined) await setCheck('Sync sides', c.sync);
    for (const [a, b] of c.lines || []) { const [x1, y1] = await at(a), [x2, y2] = await at(b); await p.drag(x1, y1, x2, y2); await sleep(800); }
    await sleep(3000); await p.shot('mode-tmj');
  },
  async reslice() {
    const c = P.reslice || {}; await preset(c.preset);
    await store(KEYS.reslice, { points: [], done: false }); await level('reslice', c.axial);
    if (c.stroke) { const pts = []; for (const q of c.stroke) pts.push(await at(q)); await p.stroke(pts); await sleep(400); await p.click(...pts[pts.length - 1], 2); await sleep(2500); }
    if (c.vrange) { await setRange('Crop from below', c.vrange[0]); await setRange('Crop from above', c.vrange[1]); await sleep(800); }
    await sleep(2500); await p.shot('mode-reslice');
  },
  async ceph() {
    // densest-only MIP: no soft-tissue profile is projected (AGENTS.md hard rule 3)
    await mode('ceph'); await sleep(1500); await setCheck('MIP', true); await sleep(1500); await p.clickText('button', 'Auto contrast'); await sleep(4000); await p.shot('mode-ceph');
  },
  async region() {
    const c = P.region || {}; await preset(c.preset); await level('region', c.axial); await p.clickText('button', 'Air'); await sleep(300);
    if (c.box) { const [x1, y1] = await at(c.box[0]), [x2, y2] = await at(c.box[1]); await p.drag(x1, y1, x2, y2); await sleep(500); }
    if (c.seed) { await p.click(...(await at(c.seed))); await sleep(6000); }
    await p.shot('mode-region');
  },
  async stitch() { await preset('Auto'); await mode('stitch'); await sleep(2500); await p.shot('mode-stitch'); },
};
PLANS.modes = async () => { for (const m of ['mpr', 'grid', 'pano', 'tmj', 'reslice', 'ceph', 'region', 'stitch']) await PLANS[m](); };

if (!plans.length) { console.error('usage: node scripts/manual-shots.mjs <plan...> [--params file.json] [--out dir] [--url url]; plans: measure, ' + Object.keys(PLANS).join(', ')); process.exit(2); }
for (const name of plans) { if (!PLANS[name]) throw new Error('unknown plan ' + name); await PLANS[name](); }
p.close();
