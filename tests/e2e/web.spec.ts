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

test('no request leaves the served origin and the CSP blocks nothing', async ({ page }) => {
  await waitForVolume(page);
  // let workers, codecs and late chunks settle
  await page.waitForTimeout(2000);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toMatch(/(^|; )connect-src 'self'(;|$)/);
});

test('the agent surface is absent from the web build', async ({ page }) => {
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
    const option = volumeSelect(page).locator('optgroup[label^="opened"] option');
    await expect(option).toHaveCount(1, { timeout: 30_000 });
    await expect(option).toContainText(folder);
    await expect(option).toContainText(geom);
    const id = await option.getAttribute('value');
    expect(id).toMatch(/^local_[0-9a-f]{12}$/);
    await expect(volumeSelect(page)).toHaveValue(id as string, { timeout: 30_000 });
    return id as string;
  }

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
    await page.locator('header').getByRole('button', { name: /series ▾/ }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Save marks to file/ }).click(),
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
    await page.locator('header').getByRole('button', { name: /series ▾/ }).click();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: /Load marks from file/ }).click(),
    ]);
    await chooser.setFiles(saved);
    await expect(measureRows).toHaveCount(1, { timeout: 30_000 });
    // the restored mark is the saved one: its recomputed length is the distance of the saved handles
    await expect(measureRows.first()).toHaveText(`↔ ${mm.toFixed(1)} mm`);
    await page.waitForTimeout(2000);
    await expect(measureRows).toHaveCount(1);
  });
});
