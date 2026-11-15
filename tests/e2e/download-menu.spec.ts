// The header's download menu (components/downloads.ts, manual section 2.5): four full-contrast
// links and a note that looks unlike them, the visitor's own system first, the Open and Help menus' keyboard and Escape, inside
// the viewport at the narrowest widths, and not one request made by opening it. No link is
// clicked: the addresses are read, never followed.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { guardPage, waitForVolume } from './helpers';

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

const ARM = ['Mac with Apple silicon', 'https://github.com/rezamotaghi/cbctscope/releases/latest/download/CBCTScope-mac-arm64.dmg'];
const X64 = ['Mac with Intel', 'https://github.com/rezamotaghi/cbctscope/releases/latest/download/CBCTScope-mac-x64.dmg'];
const WIN = ['Windows', 'https://github.com/rezamotaghi/cbctscope/releases/latest/download/CBCTScope-windows-setup.exe'];
const ALL = ['All downloads and release notes', 'https://github.com/rezamotaghi/cbctscope/releases/latest'];
const NOTE = 'Which Mac? Apple menu, About This Mac. Chip: Apple M1 or later is Apple silicon. Processor: Intel is Intel.';

/** a fresh page under a given user agent and width, the volume on screen, with the off-origin guard */
async function open(browser: Browser, baseURL: string, userAgent: string, width: number, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height }, userAgent });
  const page = await ctx.newPage();
  const problems = guardPage(page, new URL(baseURL).origin);
  await page.goto('/');
  await waitForVolume(page);
  return { ctx, page, problems };
}

const button = (page: Page) => page.locator('header').getByRole('button', { name: 'Download the desktop app', exact: true });
const menu = (page: Page) => page.getByRole('menu', { name: 'Download the desktop app' });

/** the menu's lines in order: each link as [label, address], the note as its text */
async function lines(page: Page): Promise<(string | string[])[]> {
  return menu(page).evaluate((m) =>
    Array.from(m.children)
      .filter((el) => el.getAttribute('role') !== 'separator')
      .map((el) => (el.getAttribute('role') === 'menuitem' ? [el.textContent ?? '', el.getAttribute('href') ?? ''] : el.textContent ?? '')),
  );
}

test('the menu opens on a click, lists the five lines with their addresses, and opening it requests nothing', async ({ browser, baseURL }) => {
  const { ctx, page, problems } = await open(browser, baseURL as string, MAC_UA, 1440);
  // let workers, codecs and late chunks settle, then count every request from here on
  await page.waitForTimeout(2000);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await button(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(button(page)).toHaveAttribute('aria-expanded', 'true');
  expect(await lines(page)).toEqual([ARM, X64, WIN, NOTE, ALL]);
  for (const link of await menu(page).getByRole('menuitem').all()) {
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  // the note is something to read, not to choose: smaller, the secondary text colour, regular
  // weight, under a separator; the entries are full white
  const note = page.getByTestId('download-note');
  await expect(note).toHaveText(NOTE);
  const look = (el: Element) => {
    const s = getComputedStyle(el);
    return { size: s.fontSize, colour: s.color, weight: s.fontWeight };
  };
  const [noteLook, itemLook] = await Promise.all([note.evaluate(look), menu(page).getByRole('menuitem').first().evaluate(look)]);
  expect(noteLook.size).not.toBe(itemLook.size);
  expect(noteLook.colour).not.toBe(itemLook.colour);
  expect(itemLook.colour).toBe('rgb(230, 233, 239)');
  expect(noteLook).toEqual({ size: '12px', colour: 'rgb(154, 163, 178)', weight: '400' });
  expect(await note.evaluate((el) => el.previousElementSibling?.getAttribute('role'))).toBe('separator');
  await page.waitForTimeout(1000);
  expect(requests, 'opening the menu makes no request').toEqual([]);
  expect(problems).toEqual([]);
  await ctx.close();
});

test('the visitor system comes first: Windows on Windows, the Macs on macOS and elsewhere', async ({ browser, baseURL }) => {
  for (const [ua, expected] of [
    [WIN_UA, [WIN, ARM, X64, NOTE, ALL]],
    [MAC_UA, [ARM, X64, WIN, NOTE, ALL]],
    [LINUX_UA, [ARM, X64, WIN, NOTE, ALL]],
  ] as const) {
    const { ctx, page, problems } = await open(browser, baseURL as string, ua, 1440);
    await button(page).click();
    expect(await lines(page), ua).toEqual(expected);
    expect(problems).toEqual([]);
    await ctx.close();
  }
});

test('the keyboard opens and moves through the menu; Escape closes it and gives focus back', async ({ browser, baseURL }) => {
  const { ctx, page, problems } = await open(browser, baseURL as string, MAC_UA, 1440);
  await button(page).focus();
  await page.keyboard.press('ArrowDown');
  const items = menu(page).getByRole('menuitem');
  await expect(items).toHaveCount(4);
  await expect(items.first()).toBeFocused();
  await expect(items.first()).toHaveText('Mac with Apple silicon');
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await expect(items.last()).toHaveText('All downloads and release notes');
  await page.keyboard.press('ArrowDown');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await expect(button(page)).toBeFocused();
  await expect(button(page)).toHaveAttribute('aria-expanded', 'false');
  expect(problems).toEqual([]);
  await ctx.close();
});

for (const width of [1024, 768]) {
  test(`at ${width} px the open menu stays inside the viewport and the page never scrolls sideways`, async ({ browser, baseURL }) => {
    const { ctx, page, problems } = await open(browser, baseURL as string, MAC_UA, width, 844);
    await button(page).click();
    await expect(menu(page)).toBeVisible();
    const box = (await menu(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // every line is inside the panel and none is clipped sideways
    const clipped = await menu(page).evaluate((m) => {
      const r = m.getBoundingClientRect();
      return Array.from(m.children)
        .map((el) => el.getBoundingClientRect())
        .filter((c) => c.width > 0 && (c.left < r.left - 0.5 || c.right > r.right + 0.5)).length;
    });
    expect(clipped).toBe(0);
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    expect(problems).toEqual([]);
    await ctx.close();
  });
}

test('inside the desktop app there is no download button and no menu', async ({ browser, baseURL }) => {
  const { ctx, page, problems } = await open(browser, baseURL as string, 'Mozilla/5.0 Chrome CBCTScope/0.0.0', 1600);
  await expect(page.locator('header').getByRole('button', { name: 'Help', exact: true })).toBeVisible();
  await expect(button(page)).toHaveCount(0);
  expect(problems).toEqual([]);
  await ctx.close();
});
