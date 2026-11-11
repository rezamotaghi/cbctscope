// The web build end to end (docs/web-build.md, section 8), against out/ on a static server.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { N, SERIES_COUNT, makeTempDir, removeTempDir, writeFixtures } from '../fixtures/dicomWriter';
import { guardPage, mainCanvasHasImage, viewModeLabels, waitForVolume } from './helpers';

let problems: string[] = [];

test.beforeEach(async ({ page, baseURL }) => {
  problems = guardPage(page, new URL(baseURL as string).origin);
  await page.goto('/');
});

test.afterEach(() => {
  // the network half of "nothing leaves the tab", and the CSP, checked on every test
  expect(problems).toEqual([]);
});

test('the posture line is in the header', async ({ page }) => {
  await expect(page.getByText('Research use only. Not a medical device.')).toBeVisible();
});

test('the header ends with the desktop app download, pointing at the latest release', async ({ page }) => {
  const link = page.locator('header').getByRole('link', { name: 'Download the desktop app', exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://github.com/rezamotaghi/cbctscope/releases/latest');
  // the last control of the header row
  const last = await page.locator('header a, header button, header select').last().getAttribute('aria-label');
  expect(last).toBe('Download the desktop app');
});

test('an unknown address shows the site-styled page with one title and a link back to the viewer', async ({ page }) => {
  const res = await page.goto('/no-such-page');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  expect(await page.locator('title').count()).toBe(1);
  await page.getByRole('link', { name: 'Back to the viewer' }).click();
  await waitForVolume(page);
});

test('the phantom loads without the repeated slice-lookup warning', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (msg.text().includes('No imageId found')) warnings.push(msg.text());
  });
  await page.reload();
  await waitForVolume(page);
  await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(2000);
  expect(warnings).toEqual([]);
});

test('Cmd, Ctrl and Alt chords reach the browser and change no tool, overlay or orientation', async ({ page }) => {
  await waitForVolume(page);
  // a listener added after the app's own: it sees whether the viewer swallowed the key
  await page.evaluate(() => {
    const w = window as unknown as { swallowed: string[] };
    w.swallowed = [];
    window.addEventListener('keydown', (e) => {
      if (e.defaultPrevented) w.swallowed.push(`${e.metaKey ? 'Meta+' : ''}${e.ctrlKey ? 'Control+' : ''}${e.altKey ? 'Alt+' : ''}${e.key}`);
    });
  });
  const rail = page.locator('aside');
  const crosshairs = rail.getByRole('button', { name: 'Crosshairs', exact: true });
  const pan = rail.getByRole('button', { name: 'Pan', exact: true });
  const bg = (b: typeof pan) => b.evaluate((el) => getComputedStyle(el).backgroundColor);
  const selected = await bg(crosshairs);
  const unselected = await bg(pan);
  expect(selected).not.toBe(unselected);
  const planeLines = rail.getByRole('checkbox', { name: /Plane lines/ });
  const overlays = rail.getByRole('checkbox', { name: /Show overlays/ });
  await expect(planeLines).toBeChecked();
  await expect(overlays).toBeChecked();
  await page.locator('main canvas').first().hover();
  for (const mod of ['Meta', 'Control', 'Alt']) {
    for (const key of ['o', 'w', 'c', '2', 'r', 'n', 'p', 'v']) await page.keyboard.press(`${mod}+${key}`);
  }
  expect(await page.evaluate(() => (window as unknown as { swallowed: string[] }).swallowed)).toEqual([]);
  expect(await bg(crosshairs)).toBe(selected);
  expect(await bg(pan)).toBe(unselected);
  await expect(planeLines).toBeChecked();
  await expect(overlays).toBeChecked();
  // the same keys alone still work: O switches the overlays off
  await page.keyboard.press('o');
  await expect(overlays).not.toBeChecked();
});

test('no request leaves the served origin and the CSP blocks nothing', async ({ page }) => {
  await waitForVolume(page);
  // let workers, codecs and late chunks settle
  await page.waitForTimeout(2000);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  // the viewer's page reaches its own origin only; the agent's providers live in the sandboxed
  // agent frame and its own policy (components/webCsp.mjs)
  expect(csp).toMatch(/(^|; )connect-src 'self'(;|$)/);
  expect(csp).toMatch(/(^|; )frame-src 'self'(;|$)/);
});

test('the agent frame page carries its own policy: the provider hosts and loopback, nothing else', async ({ request }) => {
  const res = await request.get('agent-frame.html');
  expect(res.ok()).toBe(true);
  const html = await res.text();
  expect(html).toContain(
    'connect-src https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com http://127.0.0.1:* http://localhost:*',
  );
  expect(html).toContain('default-src &#x27;none&#x27;');
});

test('a drag over the viewer and back out leaves no overlay; Escape clears it too', async ({ page }) => {
  await waitForVolume(page);
  const zone = page.getByTestId('drop-zone');
  // enter the viewer, cross into a child, leave the child, leave the viewer: the child's own
  // enter and leave must not clear the overlay early, and the last leave must clear it
  await page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement;
    const child = main.querySelector('canvas, div') as HTMLElement;
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'x.dcm'));
    const fire = (el: HTMLElement, type: string) =>
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, relatedTarget: document.body }));
    fire(main, 'dragenter');
    fire(child, 'dragenter');
    fire(child, 'dragleave');
    (window as unknown as { __dt: DataTransfer }).__dt = dt;
  });
  await expect(zone).toBeVisible();
  await page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement;
    const dt = (window as unknown as { __dt: DataTransfer }).__dt;
    main.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: dt, relatedTarget: document.body }));
  });
  await expect(zone).toHaveCount(0);
  // enter again, then Escape
  await page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement;
    const dt = (window as unknown as { __dt: DataTransfer }).__dt;
    main.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await expect(zone).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(zone).toHaveCount(0);
});

test('the MCP eviction banner is absent from the web build', async ({ page }) => {
  await waitForVolume(page);
  await expect(page.getByText('holds the agent connection')).toHaveCount(0);
});

test('the phantom renders', async ({ page }) => {
  await waitForVolume(page);
  await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
});

test('the research-use dialogue stays away for the phantom', async ({ page }) => {
  await waitForVolume(page);
  await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Research use only' })).toHaveCount(0);
});

test('every view mode mounts', async ({ page }) => {
  await waitForVolume(page);
  const labels = viewModeLabels();
  expect(labels.length).toBeGreaterThanOrEqual(8);
  const header = page.locator('header');
  for (const label of labels) {
    await header.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('main canvas').first(), `mode ${label} mounts a canvas`).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('main').getByText(/failed|unavailable/i), `mode ${label} shows no error`).toHaveCount(0);
  }
});

// ---------------------------------------------------------------------------
// real files through the pickers: synthetic DICOM written from the phantom into a temp folder
// under os.tmpdir() (never inside the checkout, AGENTS.md hard rule 3)

test.describe('opening files', () => {
  let tmp = '';

  test.beforeAll(() => {
    tmp = makeTempDir();
    writeFixtures(tmp);
  });

  test.afterAll(() => {
    if (tmp) removeTempDir(tmp);
  });

  const volumeSelect = (page: Page) => page.locator('header select');
  const researchDialog = (page: Page) => page.getByRole('dialog', { name: 'Research use only' });

  /** open a fixture folder through the webkitdirectory input (Playwright uploads the directory) */
  async function openFolder(page: Page, folder: string) {
    const input = page.getByTestId('open-folder-input');
    await expect(input).toHaveAttribute('webkitdirectory', '');
    await input.setInputFiles(path.join(tmp, folder));
  }

  /** the opened volume is current: the select points at a local_ id whose option names `geom` */
  async function expectCurrentLocal(page: Page, folder: string, geom: string) {
    const option = volumeSelect(page).locator('optgroup[label^="Opened"] option');
    await expect(option).toHaveCount(1, { timeout: 30_000 });
    await expect(option).toContainText(folder);
    await expect(option).toContainText(geom);
    const id = await option.getAttribute('value');
    expect(id).toMatch(/^local_[0-9a-f]{12}$/);
    await expect(volumeSelect(page)).toHaveValue(id as string, { timeout: 30_000 });
    return id as string;
  }

  test('the privacy sentences name the target they run on: this tab on the website, this computer in the desktop app', async ({ page, browser, baseURL }) => {
    // the website: the open menu prepares for the browser's "upload" wording, the dialogue says tab
    await waitForVolume(page);
    await page.locator('header').getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByText("Your browser may say 'upload': that is its word for letting this page read the files. They stay in this tab.")).toBeVisible();
    await page.keyboard.press('Escape');
    await openFolder(page, 'series');
    const web = researchDialog(page);
    await expect(web).toBeVisible({ timeout: 30_000 });
    await expect(web).toContainText('The agent moves the camera; the human reads.');
    await expect(web).toContainText("Nothing leaves this tab, except the agent's snapshots of the view, which go to the model you chose once you switch the agent on.");
    await expect(web).not.toContainText('this computer');

    // the desktop app: the same build under the shell's user-agent token
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, userAgent: 'Mozilla/5.0 Chrome CBCTScope/0.0.0' });
    const app = await ctx.newPage();
    const appProblems = guardPage(app, new URL(baseURL as string).origin);
    await app.goto('/');
    await waitForVolume(app);
    await app.locator('header').getByRole('button', { name: 'Open', exact: true }).click();
    await expect(app.getByText("The Open sheet may say 'Upload': that is its word for letting this app read the files. They stay on this computer.")).toBeVisible();
    await app.locator('header').getByRole('button', { name: 'Open', exact: true }).click();
    await openFolder(app, 'series');
    const desk = researchDialog(app);
    await expect(desk).toBeVisible({ timeout: 30_000 });
    await expect(desk).toContainText('The agent moves the camera; the human reads.');
    await expect(desk).toContainText("Nothing leaves this computer, except the agent's snapshots of the view, which go to the model you chose once you switch the agent on. The scan is read from your disk into this app.");
    await expect(desk).not.toContainText('this tab');
    expect(appProblems).toEqual([]);
    await ctx.close();
  });

  test('the fixture folder opens through the directory input', async ({ page }) => {
    await waitForVolume(page);

    // the slice-per-file series: 64 x 64 x 40
    await openFolder(page, 'series');
    await expect(researchDialog(page)).toBeVisible({ timeout: 30_000 });
    await expect(researchDialog(page)).toHaveCount(1);
    await researchDialog(page).getByRole('button', { name: 'I understand' }).click();
    await expect(researchDialog(page)).toHaveCount(0);
    const seriesId = await expectCurrentLocal(page, 'series', `${N}²×${SERIES_COUNT}`);
    await expect(page.locator('header')).toContainText('series');
    await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);

    // the multiframe file in its folder: 64 x 64 x 64; the dialogue never returns
    await openFolder(page, 'mf');
    const mfId = await expectCurrentLocal(page, 'volume', `${N}²×${N}`);
    expect(mfId).not.toBe(seriesId);
    await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
    await expect(researchDialog(page)).toHaveCount(0);

    // reload and reopen: still acknowledged in this browser profile, and the id is stable
    await page.reload();
    await waitForVolume(page);
    await openFolder(page, 'series');
    expect(await expectCurrentLocal(page, 'series', `${N}²×${SERIES_COUNT}`)).toBe(seriesId);
    await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
    await page.waitForTimeout(500);
    await expect(researchDialog(page)).toHaveCount(0);
  });

  test('the reading place stays with its volume across a volume switch', async ({ page }) => {
    await waitForVolume(page);
    await openFolder(page, 'series');
    await researchDialog(page).getByRole('button', { name: 'I understand' }).click();
    await expectCurrentLocal(page, 'series', `${N}²×${SERIES_COUNT}`);
    const axialLabel = page.locator('main [data-pane]').filter({ has: page.locator('[data-overlay="label"]', { hasText: /^AXIAL\b/ }) }).locator('[data-overlay="label"]');
    await expect(axialLabel).toHaveText(new RegExp(`^AXIAL \\d+/${SERIES_COUNT}\\b`), { timeout: 60_000 });
    const fresh = (await axialLabel.textContent()) ?? '';
    // to the phantom, move its level far from the series' default, then back to the series
    await page.locator('header').getByRole('button', { name: 'Next volume' }).click();
    await expect(axialLabel).toHaveText(/^AXIAL \d+\/200\b/, { timeout: 60_000 });
    await page.getByRole('slider', { name: 'AXIAL slice' }).focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowUp');
    await page.locator('header').getByRole('button', { name: 'Previous volume' }).click();
    await expect(axialLabel).toHaveText(new RegExp(`^AXIAL \\d+/${SERIES_COUNT}\\b`), { timeout: 60_000 });
    // the series opens on its own default: nothing of the phantom's place carried over
    await page.waitForTimeout(500);
    await expect(axialLabel).toHaveText(fresh);
  });

  test('the desktop app keeps the picked window preset through relaunch, open and relaunch', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, userAgent: 'Mozilla/5.0 Chrome CBCTScope/0.0.0' });
    const app = await ctx.newPage();
    const appProblems = guardPage(app, new URL(baseURL as string).origin);
    const bone = app.locator('aside').getByRole('button', { name: 'Bone', exact: true });
    await app.goto('/');
    await waitForVolume(app);
    await bone.click();
    await expect(bone).toHaveAttribute('aria-pressed', 'true');
    // relaunch: the phantom opens on Bone
    await app.reload();
    await waitForVolume(app);
    await expect(bone).toHaveAttribute('aria-pressed', 'true');
    // open a CT export: it opens on Bone too, and the open does not overwrite the name
    await openFolder(app, 'series');
    await researchDialog(app).getByRole('button', { name: 'I understand' }).click();
    await expectCurrentLocal(app, 'series', `${N}²×${SERIES_COUNT}`);
    await expect.poll(() => mainCanvasHasImage(app), { timeout: 60_000 }).toBe(true);
    await expect(bone).toHaveAttribute('aria-pressed', 'true');
    // relaunch again: still Bone
    await app.reload();
    await waitForVolume(app);
    await expect(bone).toHaveAttribute('aria-pressed', 'true');
    expect(await app.evaluate(() => localStorage.getItem('cbctscope-window-preset'))).toBe('Bone');
    expect(appProblems).toEqual([]);
    await ctx.close();
  });

  test('the progress panel shows during an open and leaves when the volume is on screen', async ({ page }) => {
    // hold every assembly result back 1.5 s, so the panel is caught on screen deterministically
    await page.addInitScript(() => {
      const W = window.Worker;
      window.Worker = class extends W {
        set onmessage(fn: ((e: MessageEvent) => void) | null) {
          super.onmessage = fn
            ? (e: MessageEvent) => {
                const d = e.data as { type?: string };
                if (d?.type === 'done') setTimeout(() => fn.call(this, e), 1500);
                else fn.call(this, e);
              }
            : null;
        }
      };
    });
    await page.reload();
    await waitForVolume(page);
    await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);

    await openFolder(page, 'series');
    const panel = page.getByTestId('open-progress');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toContainText(/Reading headers|Assembling the volume|Preparing the display/);
    await expect(panel).toContainText(/\d+ s/);
    await expect(panel).toContainText(/Assembling the volume: \d+ %/);
    await researchDialog(page).getByRole('button', { name: 'I understand' }).click();
    await expect(panel).toHaveCount(0, { timeout: 30_000 });
    await expectCurrentLocal(page, 'series', `${N}²×${SERIES_COUNT}`);
    await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
  });

  test('a folder with no DICOM volume says so, with the count and the reason', async ({ page }) => {
    await waitForVolume(page);
    await openFolder(page, 'junk');
    const none = page.getByTestId('open-none');
    await expect(none).toBeVisible({ timeout: 30_000 });
    // line 1: plain words and the action; the technical reason after it
    await expect(none.locator('div').first()).toHaveText(
      'These files are not DICOM images. Export from your CBCT software as DICOM, with compression off.',
    );
    await expect(none).toContainText('No DICOM volume found in 2 files');
    await expect(none).toContainText('no DICM magic bytes, not DICOM: 2 files');
    await expect(none.getByRole('button', { name: 'Open another folder' })).toBeVisible();
    await expect(page.getByTestId('open-progress')).toHaveCount(0);
    await expect(researchDialog(page)).toHaveCount(0);
    await none.getByRole('button', { name: 'Dismiss' }).click();
    await expect(none).toHaveCount(0);
    await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
  });

  test('the marks file round-trips through Save marks and Load marks', async ({ page }) => {
    await waitForVolume(page);
    await openFolder(page, 'series');
    const dialog = researchDialog(page);
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'I understand' }).click();
    const id = await expectCurrentLocal(page, 'series', `${N}²×${SERIES_COUNT}`);
    await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);

    // one measurement, drawn the way a reader draws it: the Length tool, a drag on the first pane
    const measureRows = page.locator('main').getByText(/^↔ \d+(\.\d+)? mm$/);
    await page.getByRole('button', { name: 'Length', exact: true }).click();
    const box = await page.locator('main canvas').first().boundingBox();
    if (!box) throw new Error('the first pane has no box');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - box.width * 0.15, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 4, { steps: 8 });
    await page.mouse.move(cx + box.width * 0.15, cy + 8, { steps: 8 });
    await page.mouse.up();
    await expect(measureRows).toHaveCount(1, { timeout: 15_000 });
    // the sidecar save is debounced (800 ms); let it land in IndexedDB
    await page.waitForTimeout(1500);

    // Save marks to file: capture the download
    await page.locator('header').getByRole('button', { name: 'Open', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Save marks to file' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(`${id}_marks.json`);
    const saved = path.join(tmp, 'saved-marks.json');
    await download.saveAs(saved);
    const file = JSON.parse(readFileSync(saved, 'utf8')) as { schema: string; anon: string; annotations: unknown[] };
    expect(file.schema).toBe('cbctscope-evidence-v1');
    expect(file.anon).toBe(id);
    expect(file.annotations).toHaveLength(1);
    // the length the saved handles describe, in world mm
    const [p0, p1] = (file.annotations[0] as { data: { handles: { points: number[][] } } }).data.handles.points;
    const mm = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);

    // reload, then empty this browser's sidecar store, so only the file can bring the mark back
    await page.reload();
    await waitForVolume(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('cbctscope', 1);
          open.onupgradeneeded = () => open.result.createObjectStore('evidence');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction('evidence', 'readwrite');
            tx.objectStore('evidence').clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await openFolder(page, 'series');
    expect(await expectCurrentLocal(page, 'series', `${N}²×${SERIES_COUNT}`)).toBe(id);
    await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
    await page.waitForTimeout(1000);
    await expect(measureRows).toHaveCount(0);

    // Load marks from file: the mark is back, exactly once (the remount leaves Cornerstone's
    // annotation state clean: the objects panel lists what that state holds)
    await page.locator('header').getByRole('button', { name: 'Open', exact: true }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('menuitem', { name: 'Load marks from file' }).click(),
    ]);
    await chooser.setFiles(saved);
    await expect(measureRows).toHaveCount(1, { timeout: 30_000 });
    // the restored mark is the saved one: its recomputed length is the distance of the saved handles
    await expect(measureRows.first()).toHaveText(`↔ ${mm.toFixed(1)} mm`);
    await page.waitForTimeout(2000);
    await expect(measureRows).toHaveCount(1);
  });
});

// The manual (docs/web-build.md, section 13): pages rendered from docs/ into the export.
test.describe('the manual', () => {
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'docs/manual/manifest.json'), 'utf8')) as {
    chapters: { file: string; title: string }[];
  };

  test('manual/ loads under the CSP, its contents list every manifest title', async ({ page }) => {
    await page.goto('/manual/');
    await expect(page.getByRole('heading', { level: 1, name: 'CBCTScope User Manual' })).toBeVisible();
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
    const toc = page.getByRole('navigation', { name: 'Table of contents' }).getByRole('link');
    await expect(toc).toHaveText(manifest.chapters.map((c) => c.title));
    // the stylesheet applied (same origin, allowed by the CSP)
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('the interface chapter shows its still', async ({ page }) => {
    await page.goto('/manual/03-interface.html');
    const still = page.locator('article img').first();
    await expect(still).toBeVisible();
    await expect.poll(() => still.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  });

  test('a search for "window" finds the display chapter', async ({ page }) => {
    await page.goto('/manual/index.html');
    await page.getByRole('searchbox', { name: 'Search' }).fill('window');
    const results = page.locator('#results');
    await expect(results).toBeVisible();
    await expect(results.getByRole('link', { name: /^5 · Display and windowing/ }).first()).toBeVisible();
  });

  test('the help menu opens the manual in a new tab', async ({ page, context, baseURL }) => {
    await waitForVolume(page);
    const tabProblems: string[] = [];
    context.on('page', (p) => tabProblems.push(...guardPage(p, new URL(baseURL as string).origin)));
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const [tab] = await Promise.all([context.waitForEvent('page'), page.getByRole('menuitem', { name: 'User manual', exact: true }).click()]);
    await tab.waitForLoadState();
    expect(new URL(tab.url()).pathname).toBe('/manual/index.html');
    await expect(tab.getByRole('heading', { level: 1, name: 'CBCTScope User Manual' })).toBeVisible();
    // the guide entry points at this mode's guide page
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: /reading guide$/ })).toHaveAttribute('href', 'manual/mpr.html');
    expect(tabProblems).toEqual([]);
  });
});

test.describe('the manual, drawer and phone', () => {
  const manifestTitles = () =>
    (JSON.parse(readFileSync(path.join(process.cwd(), 'docs/manual/manifest.json'), 'utf8')) as { chapters: { title: string }[] }).chapters.map(
      (c) => c.title,
    );

  test('the desktop app opens the manual in a drawer, in the dark theme', async ({ browser, baseURL }) => {
    // the desktop shell's user-agent token is the only difference the page sees (shell.ts)
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, userAgent: 'Mozilla/5.0 Chrome CBCTScope/0.0.0' });
    const page = await ctx.newPage();
    const tabProblems = guardPage(page, new URL(baseURL as string).origin);
    await page.goto('/');
    await waitForVolume(page);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('menuitem', { name: 'User manual', exact: true }).click();
    const drawer = page.getByTestId('manual-drawer');
    await expect(drawer).toBeVisible();
    // the iframe loads a page with stills; under the full suite's load it can take more than 5 s
    const frame = page.frameLocator('iframe[title="CBCTScope user manual"]');
    await expect(frame.getByRole('heading', { level: 1, name: 'CBCTScope User Manual' })).toBeVisible({ timeout: 20_000 });
    await expect(frame.locator('html')).toHaveClass(/\btheme-dark\b/, { timeout: 20_000 });
    await page.getByRole('button', { name: /Close manual/ }).click();
    await expect(drawer).toHaveCount(0);
    expect(tabProblems).toEqual([]);
    await ctx.close();
  });

  test('at 375 px the contents sit behind a visible Contents button and the text starts on the first screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/manual/05-display.html');
    const toggle = page.getByRole('button', { name: 'Contents' });
    const list = page.locator('#toc-list');
    await expect(toggle).toBeVisible();
    await expect(list).toBeHidden();
    const h1 = await page.getByRole('heading', { level: 1 }).boundingBox();
    expect(h1 && h1.y + h1.height).toBeLessThan(812);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(list).toBeVisible();
    await expect(list.getByRole('link')).toHaveText(manifestTitles());
    // the button stays on screen after a scroll
    await page.mouse.wheel(0, 3000);
    await expect(toggle).toBeInViewport();
  });
});
