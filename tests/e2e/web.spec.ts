// The web build end to end (docs/web-build.md, section 8), against out/ on a static server.
import { expect, test } from '@playwright/test';
import { LOADER_PLACEHOLDER, guardPage, mainCanvasHasImage, viewModeLabels, waitForVolume } from './helpers';

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
  const state = await waitForVolume(page);
  test.skip(state === 'no-catalog' && LOADER_PLACEHOLDER, 'needs the loader track (browserSource is the placeholder)');
  expect(state).toBe('rendered');
  await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
});

test('the research-use dialogue stays away for the phantom', async ({ page }) => {
  const state = await waitForVolume(page);
  test.skip(state === 'no-catalog' && LOADER_PLACEHOLDER, 'needs the loader track (browserSource is the placeholder)');
  await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Research use only' })).toHaveCount(0);
});

test('every view mode mounts', async ({ page }) => {
  const state = await waitForVolume(page);
  test.skip(state === 'no-catalog' && LOADER_PLACEHOLDER, 'needs the loader track (browserSource is the placeholder)');
  const labels = viewModeLabels();
  expect(labels.length).toBeGreaterThanOrEqual(8);
  const header = page.locator('header');
  for (const label of labels) {
    await header.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('main canvas').first(), `mode ${label} mounts a canvas`).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('main').getByText(/failed|unavailable/i), `mode ${label} shows no error`).toHaveCount(0);
  }
});

test.fixme('the fixture folder opens through the directory input', async () => {
  // needs the loader track: browserSource and tests/fixtures/dicomWriter.ts land there
});

test.fixme('the marks file round-trips through Save marks and Load marks', async () => {
  // needs the loader track: the sidecar store in IndexedDB lands there
});
