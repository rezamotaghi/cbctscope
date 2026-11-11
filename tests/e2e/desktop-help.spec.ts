// The desktop app's Help menu (desktop/native.mjs) opens the manual drawer by a window event
// CbctApp answers by setting the drawer's state, as its help menu does. The shell's
// user-agent token is the only difference the page sees, so a context with that token stands in
// for the app; on the website the same event opens nothing.
import { expect, test } from '@playwright/test';
import { guardPage, waitForVolume } from './helpers';

const MANUAL_EVENT = 'cbctscope:manual';

test('the desktop Help menu event opens the manual drawer', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, userAgent: 'Mozilla/5.0 Chrome CBCTScope/0.0.0' });
  const page = await ctx.newPage();
  const tabProblems = guardPage(page, new URL(baseURL as string).origin);
  await page.goto('/');
  await waitForVolume(page);
  await page.evaluate((name) => window.dispatchEvent(new Event(name)), MANUAL_EVENT);
  const drawer = page.getByTestId('manual-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('iframe')).toHaveAttribute('src', /^manual\/index\.html\?theme=dark/);
  // a second request while it is open keeps one drawer
  await page.evaluate((name) => window.dispatchEvent(new Event(name)), MANUAL_EVENT);
  await expect(page.getByTestId('manual-drawer')).toHaveCount(1);
  expect(tabProblems).toEqual([]);
  await ctx.close();
});

test('on the website the event opens no drawer and no tab', async ({ page, context }) => {
  await page.goto('/');
  await waitForVolume(page);
  const before = context.pages().length;
  await page.evaluate((name) => window.dispatchEvent(new Event(name)), MANUAL_EVENT);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('manual-drawer')).toHaveCount(0);
  expect(context.pages().length).toBe(before);
});
