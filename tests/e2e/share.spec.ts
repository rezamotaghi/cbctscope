// Help, Share CBCTScope (components/cbct/ShareMenuItem.tsx; docs/manual/03-interface.md): the
// site's name and address go to the system's share sheet where navigator.share exists, and the
// address is copied where it does not, in the desktop app, and when the sheet fails; the entry
// then says so in place. The page's navigator.share is a stub that records its calls. The first
// test writes the real clipboard and reads it back; the others record the writes instead, so
// each can also show that nothing was copied.
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { guardPage, waitForVolume } from './helpers';

const ADDRESS = 'https://cbctscope.com';
const SHARED = [{ title: 'CBCTScope', url: ADDRESS }];
const LABEL = 'Share CBCTScope';
const COPIED = 'Link copied: cbctscope.com';
const SHELL_UA = 'Mozilla/5.0 Chrome CBCTScope/0.0.0';

type ShareMode = 'absent' | 'resolve' | 'abort' | 'fail';

async function open(browser: Browser, baseURL: string, mode: ShareMode, opts: { realClipboard?: boolean; userAgent?: string } = {}) {
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: opts.userAgent });
  if (opts.realClipboard) await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseURL).origin });
  const page: Page = await ctx.newPage();
  const problems = guardPage(page, new URL(baseURL).origin);
  await page.addInitScript(
    ({ m, real }: { m: ShareMode; real: boolean }) => {
      const w = window as unknown as { __shares: unknown[]; __copies: string[] };
      w.__shares = [];
      w.__copies = [];
      if (m === 'absent') {
        delete (Navigator.prototype as { share?: unknown }).share;
        delete (navigator as { share?: unknown }).share;
      } else {
        Object.defineProperty(Navigator.prototype, 'share', {
          configurable: true,
          value: (data: unknown) => {
            w.__shares.push(data);
            if (m === 'resolve') return Promise.resolve();
            return Promise.reject(new DOMException('no sheet', m === 'abort' ? 'AbortError' : 'NotAllowedError'));
          },
        });
      }
      if (!real) {
        Object.defineProperty(Clipboard.prototype, 'writeText', {
          configurable: true,
          value: (text: string) => {
            w.__copies.push(text);
            return Promise.resolve();
          },
        });
      }
    },
    { m: mode, real: !!opts.realClipboard },
  );
  await page.goto('/');
  await waitForVolume(page);
  await page.locator('header').getByRole('button', { name: 'Help', exact: true }).click();
  const menu = page.getByRole('menu', { name: 'Help' });
  const entry = menu.getByTestId('share-site');
  await expect(entry).toHaveText(LABEL);
  const record = () =>
    page.evaluate(() => {
      const w = window as unknown as { __shares: unknown[]; __copies: string[] };
      return { shares: w.__shares, copies: w.__copies };
    });
  return { ctx, page, problems, menu, entry, record };
}

test('the Help menu lists Share CBCTScope between the citation and the legal notice, as a menu entry', async ({ browser, baseURL }) => {
  const { ctx, problems, menu, entry } = await open(browser, baseURL as string, 'absent');
  const labels = await menu.getByRole('menuitem').allTextContents();
  expect(labels.slice(-5)).toEqual(['About CBCTScope', 'Cite this software', LABEL, 'Legal notice', 'Source code repository']);
  await expect(entry).toHaveAttribute('role', 'menuitem');
  await expect(entry).toHaveAttribute('title', /cbctscope\.com.*the scan on screen is never shared/);
  expect(problems).toEqual([]);
  await ctx.close();
});

test('without a share sheet, a click copies the site address to the clipboard and the entry says so, the menu staying open', async ({ browser, baseURL }) => {
  const { ctx, page, problems, menu, entry, record } = await open(browser, baseURL as string, 'absent', { realClipboard: true });
  await entry.click();
  await expect(entry).toHaveText(COPIED);
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ADDRESS);
  expect((await record()).shares).toEqual([]);
  // reopened, the entry reads as before
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.locator('header').getByRole('button', { name: 'Help', exact: true }).click();
  await expect(menu.getByTestId('share-site')).toHaveText(LABEL);
  expect(problems).toEqual([]);
  await ctx.close();
});

test('with a share sheet, a click shares the site name and address once, copies nothing, and the menu closes', async ({ browser, baseURL }) => {
  const { ctx, problems, menu, entry, record } = await open(browser, baseURL as string, 'resolve');
  await entry.click();
  await expect(menu).toHaveCount(0);
  expect(await record()).toEqual({ shares: SHARED, copies: [] });
  expect(problems).toEqual([]);
  await ctx.close();
});

test('a cancelled share sheet copies nothing and leaves the entry as it was', async ({ browser, baseURL }) => {
  const { ctx, page, problems, menu, entry, record } = await open(browser, baseURL as string, 'abort');
  await entry.click();
  await expect.poll(async () => (await record()).shares.length).toBe(1);
  await page.evaluate(() => new Promise((res) => setTimeout(res, 50)));
  await expect(entry).toHaveText(LABEL);
  await expect(menu).toBeVisible();
  expect((await record()).copies).toEqual([]);
  expect(problems).toEqual([]);
  await ctx.close();
});

test('a share sheet that fails to open falls back to copying the address', async ({ browser, baseURL }) => {
  const { ctx, problems, entry, record } = await open(browser, baseURL as string, 'fail');
  await entry.click();
  await expect(entry).toHaveText(COPIED);
  expect(await record()).toEqual({ shares: SHARED, copies: [ADDRESS] });
  expect(problems).toEqual([]);
  await ctx.close();
});

test('the desktop app copies the address and never asks for a share sheet', async ({ browser, baseURL }) => {
  const { ctx, problems, entry, record } = await open(browser, baseURL as string, 'resolve', { userAgent: SHELL_UA });
  await entry.click();
  await expect(entry).toHaveText(COPIED);
  expect(await record()).toEqual({ shares: [], copies: [ADDRESS] });
  expect(problems).toEqual([]);
  await ctx.close();
});

test('a refused clipboard shows the address in the entry instead', async ({ browser, baseURL }) => {
  const { ctx, page, problems, entry } = await open(browser, baseURL as string, 'absent');
  await page.evaluate(() => {
    Object.defineProperty(Clipboard.prototype, 'writeText', { configurable: true, value: () => Promise.reject(new DOMException('refused', 'NotAllowedError')) });
  });
  await entry.click();
  await expect(entry).toHaveText('Could not copy. The address is cbctscope.com');
  expect(problems).toEqual([]);
  await ctx.close();
});
