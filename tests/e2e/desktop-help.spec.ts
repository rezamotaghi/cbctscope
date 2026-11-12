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

test('in the desktop app the Help menu shows About and Legal notice in the drawer', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, userAgent: 'Mozilla/5.0 Chrome CBCTScope/0.0.0' });
  const page = await ctx.newPage();
  const problems = guardPage(page, new URL(baseURL as string).origin);
  await page.goto('/');
  await waitForVolume(page);
  const help = page.locator('header').getByRole('button', { name: 'Help', exact: true });
  for (const [label, src, heading] of [
    ['About CBCTScope', 'about', 'About CBCTScope'],
    ['Legal notice', 'legal', 'Legal notice and privacy'],
  ]) {
    await help.click();
    await page.getByRole('menu', { name: 'Help' }).getByRole('menuitem', { name: label }).click();
    const drawer = page.getByTestId('manual-drawer');
    await expect(drawer.locator('iframe')).toHaveAttribute('src', src);
    await expect(page.frameLocator('[data-testid="manual-drawer"] iframe').getByRole('heading', { level: 1, name: heading })).toBeVisible();
    if (src === 'about') {
      // the author's name leaves the drawer through a new-window request, which the app sends to the system browser
      const author = page.frameLocator('[data-testid="manual-drawer"] iframe').locator('main').getByRole('link', { name: 'Dr. Reza Motaghi', exact: true });
      await expect(author).toHaveAttribute('href', 'https://rezamotaghi.com');
      await expect(author).toHaveAttribute('target', '_blank');
    }
    await drawer.getByRole('button', { name: 'Close page' }).click();
    await expect(drawer).toHaveCount(0);
  }
  expect(problems).toEqual([]);
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
