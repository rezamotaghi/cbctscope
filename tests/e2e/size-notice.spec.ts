// The size notice on the low-threshold build (out-small/, NEXT_PUBLIC_CBCTSCOPE_SIZE_NOTICE_MIB=1):
// the phantom (25 MiB of voxels) trips it on landing.
import { expect, test } from '@playwright/test';
import { LOADER_PLACEHOLDER, guardPage, mainCanvasHasImage } from './helpers';

test('the size notice holds a large volume back; Cancel leaves the previous state', async ({ page, baseURL }) => {
  const problems = guardPage(page, new URL(baseURL as string).origin);
  await page.goto('/');
  const notice = page.getByRole('dialog', { name: 'Large volume' });
  const failed = page.getByText('volume catalog unavailable');
  await expect(notice.or(failed)).toBeVisible({ timeout: 60_000 });
  test.skip((await failed.isVisible()) && LOADER_PLACEHOLDER, 'needs the loader track (browserSource is the placeholder)');

  await expect(notice).toContainText('The local app has no such limit.');
  await notice.getByRole('button', { name: 'Cancel' }).click();
  await expect(notice).toHaveCount(0);
  // nothing was loaded: no volume on screen, no canvas
  await expect(page.getByText('no volume open')).toBeVisible();
  await expect(page.locator('main canvas')).toHaveCount(0);

  // choosing it again asks again; Continue loads it
  const phantom = await page.locator('header select option').filter({ hasText: 'Synthetic phantom' }).getAttribute('value');
  await page.locator('header select').selectOption(phantom as string);
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Continue' }).click();
  await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
  expect(problems).toEqual([]);
});
