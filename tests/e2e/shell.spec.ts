// The reading screen's shell end to end: the header row, the status line, the side rail, the
// menus and the dialogues, at the widths a reader meets (docs/manual/03-interface.md).
import { expect, test, type Page } from '@playwright/test';
import { guardPage, waitForVolume } from './helpers';

let problems: string[] = [];

test.beforeEach(async ({ page, baseURL }) => {
  problems = guardPage(page, new URL(baseURL as string).origin);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

async function load(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await waitForVolume(page);
}

/** the header's controls as boxes, and whether any two overlap */
async function headerOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('header button, header select, header a, header .tabs'));
    const boxes = els
      .filter((e) => !e.closest('.tabs') || e.classList.contains('tabs'))
      .map((e) => ({ name: e.getAttribute('aria-label') || e.textContent?.trim() || e.tagName, r: e.getBoundingClientRect() }))
      .filter((b) => b.r.width > 0);
    const out: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r;
        const b = boxes[j].r;
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) {
          out.push(`${boxes[i].name} / ${boxes[j].name}`);
        }
      }
    return out;
  });
}

for (const width of [1024, 1280, 1440, 1600]) {
  test(`at ${width} px the header holds every control without overlap, in its rows of 44 px`, async ({ page }) => {
    await load(page, width);
    const header = page.locator('header');
    const h = (await header.boundingBox())!.height;
    // one row of 44 px where the width holds every control (about 1410 px and up); a
    // narrower window wraps whole groups onto a second row, never hiding or shrinking one
    if (width >= 1440) expect(h, `header height at ${width}`).toBeLessThanOrEqual(44);
    else expect(h, `header height at ${width}`).toBeLessThanOrEqual(80);
    expect(await headerOverlaps(page)).toEqual([]);
    // previous, the volume list and next sit on one line
    const prev = (await page.getByRole('button', { name: 'Previous volume' }).boundingBox())!;
    const next = (await page.getByRole('button', { name: 'Next volume' }).boundingBox())!;
    expect(Math.abs(prev.y - next.y)).toBeLessThan(2);
    // the download is the header's last control, labelled in full only where it fits
    const dl = header.getByRole('link', { name: 'Download the desktop app' });
    await expect(dl).toBeVisible();
    expect(await dl.innerText()).toBe(width >= 1500 ? 'Download the desktop app' : 'Desktop app');
  });
}

for (const width of [390, 768, 1024]) {
  test(`at ${width} px the page never scrolls sideways and the side rail never overflows`, async ({ page }) => {
    await load(page, width, 844);
    const over = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rail: (() => {
        const a = document.querySelector('aside') as HTMLElement;
        return a.scrollWidth - a.clientWidth;
      })(),
    }));
    expect(over.page, 'horizontal page overflow in px').toBeLessThanOrEqual(0);
    expect(over.rail, 'side rail overflow in px').toBeLessThanOrEqual(0);
  });
}

test('below 768 px a full-contrast notice says a phone is for the phantom; at 1024 px it is gone', async ({ page }) => {
  await load(page, 390, 844);
  const notice = page.getByRole('note');
  await expect(notice).toHaveText('CBCTScope reads scans in a desktop browser. Here you can look at the built-in phantom.');
  expect(await notice.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(230, 233, 239)');
  // the Open menu stays inside the viewport
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  const menu = (await page.getByRole('menu', { name: 'Open' }).boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1024, height: 844 });
  await expect(notice).toBeHidden();
});

test('the selected mode tab is solid accent with dark text, and the mode switch is unlike a button', async ({ page }) => {
  await load(page, 1440);
  const tab = page.locator('header').getByRole('button', { name: 'MPR', exact: true });
  const other = page.locator('header').getByRole('button', { name: 'Grid', exact: true });
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  const style = (l: typeof tab) => l.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
  const sel = await style(tab);
  expect(sel).toEqual({ bg: 'rgb(76, 141, 255)', fg: 'rgb(12, 14, 18)' });
  // contrast of the selected fill against the unselected tab's ground (the tab group's)
  const ground = await page.locator('header .tabs').evaluate((el) => getComputedStyle(el).backgroundColor);
  const lum = (rgb: string) => {
    const [r, g, b] = rgb.match(/\d+/g)!.slice(0, 3).map((v) => {
      const c = Number(v) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  expect(ratio(sel.bg, ground)).toBeGreaterThanOrEqual(3);
  expect(ratio(sel.bg, sel.fg)).toBeGreaterThanOrEqual(4.5);
  expect((await style(other)).bg).not.toBe(sel.bg);
  // an action button is a raised chip with a visible border; a tab is not
  const open = page.getByRole('button', { name: 'Open', exact: true });
  expect(await open.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe('rgb(107, 115, 132)');
  expect(await other.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    await open.evaluate((el) => getComputedStyle(el).backgroundColor),
  );
});

test('no control in the shell carries an emoji, a pictograph or an arrow character', async ({ page }) => {
  await load(page, 1440);
  // open every header menu and the Keys card, and the agent strip, so their entries are in the DOM
  const scan = () =>
    page.evaluate(() => {
      const bad = /[\p{Extended_Pictographic}←-⇿⌀-⏿■-◿☀-➿⟰-⟿⤀-⥿⬀-⯿]/u;
      const roots = Array.from(document.querySelectorAll('header, aside, [data-testid="status-line"], [data-testid="agent-panel"], [role="menu"], [role="dialog"]'));
      const hits: string[] = [];
      for (const root of roots) {
        for (const el of Array.from(root.querySelectorAll('button, a, select, option, optgroup, label, [role="menuitem"]'))) {
          const text = (el.textContent ?? '') + ' ' + (el.getAttribute('label') ?? '');
          if (bad.test(text)) hits.push(text.trim().slice(0, 60));
        }
      }
      return hits;
    });
  expect(await scan()).toEqual([]);
  for (const name of ['Open', 'Help', 'Keys', 'Agent']) {
    await page.locator('header').getByRole('button', { name, exact: true }).click();
    expect(await scan(), `with ${name} open`).toEqual([]);
    await page.keyboard.press('Escape');
  }
});

test('Escape and a click on the image close every menu and popover; arrows move through a menu', async ({ page }) => {
  await load(page, 1440);
  const header = page.locator('header');
  // Escape
  await header.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Open' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Open' })).toHaveCount(0);
  await header.getByRole('button', { name: 'Keys', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Keys' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Keys' })).toHaveCount(0);
  // a click on the image (a pane away from the open panel)
  const clickImage = async () => {
    const m = (await page.locator('main canvas').last().boundingBox())!;
    await page.mouse.click(m.x + m.width - 30, m.y + m.height - 30);
  };
  await header.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.getByRole('menu', { name: 'Help' })).toBeVisible();
  await clickImage();
  await expect(page.getByRole('menu', { name: 'Help' })).toHaveCount(0);
  await header.getByRole('button', { name: /^v\d/ }).click();
  await expect(page.getByRole('dialog', { name: 'About CBCTScope' })).toBeVisible();
  await clickImage();
  await expect(page.getByRole('dialog', { name: 'About CBCTScope' })).toHaveCount(0);
  // the keyboard: ArrowDown on the button opens the menu at its first entry, arrows move on
  const help = header.getByRole('button', { name: 'Help', exact: true });
  await help.focus();
  await page.keyboard.press('ArrowDown');
  const items = page.getByRole('menu', { name: 'Help' }).getByRole('menuitem');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(items.last()).toBeFocused();
  await expect(items.last()).toHaveText('Source code repository');
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();
  // keyboard focus is a 2 px accent ring, never a fill
  const ring = await help.evaluate((el) => ({ o: getComputedStyle(el).outlineStyle, w: getComputedStyle(el).outlineWidth, c: getComputedStyle(el).outlineColor }));
  expect(ring).toEqual({ o: 'solid', w: '2px', c: 'rgb(76, 141, 255)' });
});

test('the Keys card lists only the current mode\'s keys', async ({ page }) => {
  await load(page, 1440);
  const header = page.locator('header');
  await header.getByRole('button', { name: 'Keys', exact: true }).click();
  const card = page.getByRole('dialog', { name: 'Keys' });
  await expect(card).toContainText('W: window/level tool');
  await page.keyboard.press('Escape');
  await header.getByRole('button', { name: 'Pano', exact: true }).click();
  await header.getByRole('button', { name: 'Keys', exact: true }).click();
  await expect(card).toContainText('N / P: next / previous volume');
  await expect(card).not.toContainText('W: window/level tool');
});

test('Tab stays inside an open dialogue', async ({ page }) => {
  await load(page, 1440);
  await page.locator('header').getByTestId('agent-status').click();
  const strip = page.getByTestId('agent-panel');
  await strip.getByRole('button', { name: 'Set up the navigation agent' }).click();
  await strip.getByLabel('Provider').selectOption({ label: 'Model server on this computer' });
  await strip.getByLabel('Model name').fill('any-model');
  await strip.getByRole('button', { name: 'Switch on…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Switch on the navigation agent' });
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement)), `focus inside after press ${i + 1}`).toBe(true);
  }
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('the status line carries the case facts, the first-run line and its link, and the legend', async ({ page }) => {
  await load(page, 1440);
  const line = page.getByTestId('status-line');
  await expect(line).toContainText('256²×200');
  await expect(line.getByTestId('first-run')).toContainText('Your scan is read in this tab and never uploaded.');
  const link = line.getByRole('link', { name: 'See CBCTScope on a real scan' });
  await expect(link).toHaveAttribute('href', 'https://github.com/rezamotaghi/cbctscope#the-interface-at-a-glance');
  expect(await link.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(230, 233, 239)');
  await expect(line).toContainText('Double-click a slider to reset it.');
  // the phantom is named once, in the volume list
  await expect(page.locator('header select option:checked')).toContainText('Geometric test phantom');
  await expect(line).not.toContainText('phantom');
  // the header still holds no case facts
  await expect(page.locator('header')).not.toContainText('µm');
});
