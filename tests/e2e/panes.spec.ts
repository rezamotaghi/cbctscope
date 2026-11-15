// The image panes' overlay (manual section 3.7): the window readout and slice n/N in every
// slice pane, the accent frame on the pane the pointer is in, no two overlay boxes on top of
// each other at the minimum desktop size and at a common laptop size, and the reading place
// carried across a mode switch.
import { expect, test, type Page } from '@playwright/test';
import { guardPage, waitForVolume } from './helpers';

let problems: string[] = [];

test.beforeEach(async ({ page, baseURL }) => {
  problems = guardPage(page, new URL(baseURL as string).origin);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

/** the mode switch, whether the header draws it as buttons or as tabs */
async function openMode(page: Page, label: string) {
  const header = page.locator('header');
  await header.getByRole('button', { name: label, exact: true }).or(header.getByRole('tab', { name: label, exact: true })).click();
}

/** the MPR slice panes, by the plane name their label starts with */
const slicePane = (page: Page, plane: string) =>
  page.locator('main [data-pane]').filter({ has: page.locator('[data-overlay="label"]', { hasText: new RegExp(`^${plane}\\b`) }) });

/** every pair of visible overlay boxes inside one pane that share area, as readable strings */
async function overlapsInPanes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    for (const pane of Array.from(document.querySelectorAll('main [data-pane]'))) {
      if (!visible(pane)) continue;
      const boxes = Array.from(pane.querySelectorAll('[data-overlay]'))
        .filter((el) => visible(el) && !el.parentElement?.closest('[data-overlay]'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].r;
          const b = boxes[j].r;
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w > 0.5 && h > 0.5) {
            const name = (el: Element) => `${el.getAttribute('data-overlay')} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
            out.push(`${pane.getAttribute('data-pane')}: ${name(boxes[i].el)} over ${name(boxes[j].el)}`);
          }
        }
      }
    }
    return out;
  });
}

test('every MPR slice pane shows its plane, slice n/N and the window, and the scale bar', async ({ page }) => {
  await page.goto('/');
  await waitForVolume(page);
  for (const plane of ['AXIAL', 'SAGITTAL', 'CORONAL']) {
    const pane = slicePane(page, plane);
    await expect(pane).toHaveCount(1);
    await expect(pane.locator('[data-overlay="label"]')).toHaveText(new RegExp(`^${plane} \\d+/\\d+ `), { timeout: 60_000 });
    await expect(pane.getByTestId('pane-wl')).toHaveText(/^W \d+ L -?\d+$/);
    await expect(pane.getByTestId('pane-scale')).toHaveText(/^\d+ (mm|cm)$/);
    // the overlay text carries no gesture hints
    await expect(pane.locator('[data-overlay="label"]')).not.toContainText('drag');
  }
  // the window readout follows a preset
  await page.locator('aside').getByRole('button', { name: 'Bone', exact: true }).click();
  await expect(slicePane(page, 'AXIAL').getByTestId('pane-wl')).toHaveText('W 4000 L 700');
});

test('the pane under the pointer carries the accent frame, and only that one', async ({ page }) => {
  await page.goto('/');
  await waitForVolume(page);
  const frameOf = (plane: string) => slicePane(page, plane).locator('[data-active-frame]');
  for (const plane of ['SAGITTAL', 'CORONAL', 'AXIAL']) {
    await slicePane(page, plane).hover({ position: { x: 80, y: 120 } });
    await expect(slicePane(page, plane)).toHaveAttribute('data-active-pane', 'true');
    await expect(page.locator('main [data-active-pane="true"]')).toHaveCount(1);
    await expect(frameOf(plane)).toHaveCSS('border-top-color', 'rgb(76, 141, 255)');
  }
  // the frame stays on the last pane when the pointer leaves the panes
  await page.locator('aside').hover();
  await expect(slicePane(page, 'AXIAL')).toHaveAttribute('data-active-pane', 'true');
});

for (const [w, h] of [
  [1024, 700],
  [1440, 900],
] as const) {
  test(`no two overlay boxes meet in MPR, Pano and TMJ at ${w} x ${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await waitForVolume(page);
    await expect(slicePane(page, 'AXIAL').getByTestId('pane-wl')).toBeVisible({ timeout: 60_000 });
    // a length drawn on the axial pane brings the objects list, which sits under the panes
    await page.locator('aside').getByRole('button', { name: 'Length', exact: true }).click();
    const box = (await slicePane(page, 'AXIAL').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId('objects-list')).toBeVisible();
    expect(await overlapsInPanes(page), 'MPR').toEqual([]);

    await openMode(page, 'Pano');
    await expect(page.locator('main [data-pane="axial"] [data-overlay="label"]')).toHaveText(/^AXIAL \d+\/\d+/, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Auto arch', exact: true }).click();
    await page.waitForTimeout(1500);
    expect(await overlapsInPanes(page), 'Pano').toEqual([]);

    await openMode(page, 'TMJ');
    await expect(page.locator('main [data-pane="axial"] [data-overlay="label"]')).toHaveText(/^AXIAL \d+\/\d+/, { timeout: 60_000 });
    expect(await overlapsInPanes(page), 'TMJ').toEqual([]);
  });
}

/** the slice ordinal a pane label shows, without the plane name */
const ordinal = async (page: Page, plane: string) =>
  ((await slicePane(page, plane).locator('[data-overlay="label"]').textContent()) ?? '').replace(new RegExp(`^${plane} `), '');

for (const mode of ['Pano', 'TMJ', 'Reslice', 'Region']) {
  test(`the reading place carries from MPR to ${mode} and back: the axial level and the crosshair's x and y`, async ({ page }) => {
    await page.goto('/');
    await waitForVolume(page);
    await expect(slicePane(page, 'AXIAL').locator('[data-overlay="label"]')).toHaveText(/^AXIAL \d+\/\d+/, { timeout: 60_000 });
    // move all three planes: z on the axial slider, x and y on the sagittal and coronal sliders
    const moved: Record<string, string> = {};
    for (const [plane, presses] of [
      ['AXIAL', 12],
      ['SAGITTAL', 9],
      ['CORONAL', 7],
    ] as const) {
      const before = await ordinal(page, plane);
      await page.getByRole('slider', { name: `${plane} slice` }).focus();
      for (let i = 0; i < presses; i++) await page.keyboard.press('ArrowUp');
      await expect.poll(() => ordinal(page, plane)).not.toBe(before);
      moved[plane] = await ordinal(page, plane);
    }

    await openMode(page, mode);
    await expect(page.locator('main [data-pane="axial"] [data-overlay="label"]')).toHaveText(new RegExp(`^AXIAL ${moved.AXIAL.replace(/[/]/g, '\\/')}`), {
      timeout: 60_000,
    });

    await openMode(page, 'MPR');
    for (const plane of ['AXIAL', 'SAGITTAL', 'CORONAL']) {
      await expect(slicePane(page, plane).locator('[data-overlay="label"]'), plane).toHaveText(`${plane} ${moved[plane]}`, { timeout: 60_000 });
    }
  });
}

test('the axial level carries from MPR to Pano and back', async ({ page }) => {
  await page.goto('/');
  await waitForVolume(page);
  const axial = slicePane(page, 'AXIAL');
  const label = axial.locator('[data-overlay="label"]');
  await expect(label).toHaveText(/^AXIAL \d+\/\d+/, { timeout: 60_000 });
  const before = (await label.textContent()) ?? '';
  const slider = page.getByRole('slider', { name: 'AXIAL slice' });
  await slider.focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowUp');
  await expect(label).not.toHaveText(before);
  const moved = ((await label.textContent()) ?? '').replace(/^AXIAL /, '');

  await openMode(page, 'Pano');
  await expect(page.locator('main [data-pane="axial"] [data-overlay="label"]')).toHaveText(`AXIAL ${moved}`, { timeout: 60_000 });

  await openMode(page, 'MPR');
  await expect(slicePane(page, 'AXIAL').locator('[data-overlay="label"]')).toHaveText(`AXIAL ${moved}`, { timeout: 60_000 });
});
