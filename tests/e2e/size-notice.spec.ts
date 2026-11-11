// The size notice on the low-threshold build (out-small/, NEXT_PUBLIC_CBCTSCOPE_SIZE_NOTICE_MIB=1):
// the phantom (25 MiB of voxels) trips it on landing.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { makeTempDir, multiframeBytes, removeTempDir } from '../fixtures/dicomWriter';
import { guardPage, mainCanvasHasImage } from './helpers';

test('the size notice holds a large volume back; Cancel leaves the previous state', async ({ page, baseURL }) => {
  const problems = guardPage(page, new URL(baseURL as string).origin);
  await page.goto('/');
  const notice = page.getByRole('dialog', { name: 'Large volume' });
  await expect(notice).toBeVisible({ timeout: 60_000 });

  await expect(notice).toContainText('The viewer run from the repository holds the whole volume in a browser tab as well; it only shows no notice.');
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

// A first real open on a large export raises two dialogues. They come one at a time: the
// research-use dialogue first, the size notice only after it is answered. Found on 04/11/26 with
// an 801-cube export: both had been mounted in the same render, one on top of the other.
test('on a first real open the research dialogue comes first and the size notice after it', async ({ page, baseURL }) => {
  const problems = guardPage(page, new URL(baseURL as string).origin);
  const tmp = makeTempDir();
  try {
    // 128 x 128 x 64 voxels, 2 MiB: above the 1 MiB threshold of this build
    const rows = 128, cols = 128, frames = 64;
    const px = new Uint8Array(rows * cols * frames * 2);
    for (let i = 0; i < px.length; i += 2) {
      const v = 1024 + ((i >> 1) % 2000);
      px[i] = v & 255;
      px[i + 1] = v >> 8;
    }
    fs.mkdirSync(path.join(tmp, 'big'));
    fs.writeFileSync(path.join(tmp, 'big', 'volume.dcm'), multiframeBytes({ rows, cols, frames, pixelBytes: px }));

    await page.goto('/');
    const notice = page.getByRole('dialog', { name: 'Large volume' });
    await expect(notice).toBeVisible({ timeout: 60_000 });
    await notice.getByRole('button', { name: 'Cancel' }).click(); // the phantom's own notice

    await page.getByTestId('open-folder-input').setInputFiles(path.join(tmp, 'big'));
    const research = page.getByRole('dialog', { name: 'Research use only' });
    await expect(research).toBeVisible({ timeout: 60_000 });
    await expect(notice).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(1);

    await research.getByRole('button', { name: 'I understand' }).click();
    await expect(research).toHaveCount(0);
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText('holds 2 MiB of voxels');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await notice.getByRole('button', { name: 'Continue' }).click();
    await expect.poll(() => mainCanvasHasImage(page), { timeout: 60_000 }).toBe(true);
    expect(problems).toEqual([]);
  } finally {
    removeTempDir(tmp);
  }
});
