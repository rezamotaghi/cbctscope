// The site's text pages and the Help menu's three entries for them (docs/web-build.md, section
// 14): About CBCTScope and Legal notice open their pages in a new tab, Cite this software opens
// the dialogue with the reference line and the BibTeX entry, whose copy buttons write the
// clipboard on a click. No request leaves the served origin on any page while doing so.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext } from '@playwright/test';
import { waitForVolume } from './helpers';

/** every request of every page in the context, off-origin ones collected */
function guardContext(context: BrowserContext, origin: string): string[] {
  const problems: string[] = [];
  context.on('request', (req) => {
    const url = req.url();
    if (/^(blob|data):/.test(url)) return;
    if (new URL(url).origin !== origin) problems.push(`off-origin request: ${url}`);
  });
  context.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) problems.push(`CSP: ${msg.text()}`);
  });
  return problems;
}

const cffVersion = /^version: (.+)$/m.exec(readFileSync(path.join(process.cwd(), 'CITATION.cff'), 'utf8'))?.[1];

test('the Help menu opens About, the citation and the legal notice, and nothing leaves the origin', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL as string).origin;
  const problems = guardContext(context, origin);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await page.goto('/');
  await waitForVolume(page);
  const help = page.locator('header').getByRole('button', { name: 'Help', exact: true });
  const menu = page.getByRole('menu', { name: 'Help' });

  // About CBCTScope: the About page, in a new tab
  await help.click();
  const [about] = await Promise.all([context.waitForEvent('page'), menu.getByRole('menuitem', { name: 'About CBCTScope' }).click()]);
  await about.waitForLoadState('load');
  expect(new URL(about.url()).pathname).toBe('/about');
  await expect(about.getByRole('heading', { level: 1, name: 'About CBCTScope' })).toBeVisible();
  await expect(about.getByRole('heading', { name: 'How to cite it' })).toBeVisible();
  await about.close();

  // Cite this software: the dialogue, from CITATION.cff, with working copy buttons
  await help.click();
  await menu.getByRole('menuitem', { name: 'Cite this software' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cite this software' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('cite-reference')).toContainText(`(Version ${cffVersion})`);
  await expect(dialog.getByTestId('cite-bibtex')).toContainText('@software{');
  await dialog.getByRole('button', { name: 'Copy reference' }).click();
  await expect(dialog.getByText('Copied.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`(Version ${cffVersion}) [Computer software]`);
  await dialog.getByRole('button', { name: 'Copy BibTeX' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^@software\{/);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Legal notice: the legal page, in a new tab
  await help.click();
  const [legal] = await Promise.all([context.waitForEvent('page'), menu.getByRole('menuitem', { name: 'Legal notice' }).click()]);
  await legal.waitForLoadState('load');
  expect(new URL(legal.url()).pathname).toBe('/legal');
  await expect(legal.getByRole('heading', { level: 1, name: 'Legal notice and privacy' })).toBeVisible();
  await expect(legal.getByText('Vienna, Austria')).toBeVisible();
  await legal.close();

  await page.waitForTimeout(500);
  expect(problems).toEqual([]);
});

test('the About popover links the About page', async ({ page }) => {
  await page.goto('/');
  await waitForVolume(page);
  await page.locator('header').getByRole('button', { name: /^v\d/ }).click();
  await expect(page.getByRole('dialog', { name: 'About CBCTScope' }).getByRole('link', { name: 'About CBCTScope and how to cite it' })).toHaveAttribute('href', 'about');
});

test('the home page shows its text and links until the viewer takes their place', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(baseURL as string);
  await expect(page.getByRole('heading', { level: 1, name: 'CBCTScope' })).toBeVisible();
  await expect(page.getByText('The viewer needs JavaScript. The manual and the pages below do not.')).toBeVisible();
  await expect(page.getByText('The viewer is loading.')).toBeHidden();
  await page.getByRole('link', { name: 'MPR reading guide' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'MPR' })).toBeVisible();
  await ctx.close();
});
