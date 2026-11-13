// The desktop app's menus (desktop/native.mjs) reach the page through the hooks desktop/main.mjs
// runs in it: window events CbctApp answers by setting the drawer's or the citation dialogue's
// state, as its help menu does, and clicks on the page's own controls. The scripts run here are
// native.mjs's own. The shell's user-agent token is the only difference the page sees, so a
// context with that token stands in for the app; on the website the same events open nothing.
// The update page the Check for Updates item opens is driven here too, by its address.
import { expect, test, type Browser } from '@playwright/test';
import { guardPage, waitForVolume } from './helpers';
import { CITE_EVENT, FILE_INPUT, FOLDER_INPUT, LEGAL_PAGE, MANUAL_EVENT, SHORTCUTS_PAGE, SNAPSHOT_BUTTON, clickScript, eventScript, updateUrl } from '../../desktop/native.mjs';
import pkg from '../../package.json';
import { compareVersions, versionFromHash } from '../../components/updateCheck';
import { radiographBytes } from '../fixtures/dicomWriter';

const SHELL_UA = 'Mozilla/5.0 Chrome CBCTScope/0.0.0';
const shellContext = (browser: Browser) => browser.newContext({ viewport: { width: 1600, height: 1000 }, userAgent: SHELL_UA });

test('the desktop Help menu event opens the manual drawer', async ({ browser, baseURL }) => {
  const ctx = await shellContext(browser);
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
  const ctx = await shellContext(browser);
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

test('the desktop Help menu opens chapter 12 and the legal notice in the drawer, and ignores a page it does not know', async ({ browser, baseURL }) => {
  const ctx = await shellContext(browser);
  const page = await ctx.newPage();
  const problems = guardPage(page, new URL(baseURL as string).origin);
  await page.goto('/');
  await waitForVolume(page);
  const drawer = page.getByTestId('manual-drawer');
  // a page the drawer does not know: nothing opens
  for (const bad of ['13-missing.html', '../legal', 'https://example.com/']) await page.evaluate(eventScript(MANUAL_EVENT, bad));
  await page.waitForTimeout(500);
  await expect(drawer).toHaveCount(0);
  // Keyboard and Mouse Reference: chapter 12
  await page.evaluate(eventScript(MANUAL_EVENT, SHORTCUTS_PAGE));
  await expect(drawer.locator('iframe')).toHaveAttribute('src', /^manual\/12-shortcuts\.html\?theme=dark/);
  await expect(page.frameLocator('[data-testid="manual-drawer"] iframe').getByRole('heading', { level: 1, name: /Keyboard and mouse reference/ })).toBeVisible();
  // Legal Notice: the legal page, as the page's own Help menu shows it
  await page.evaluate(eventScript(MANUAL_EVENT, LEGAL_PAGE));
  await expect(page.getByTestId('manual-drawer')).toHaveCount(1);
  await expect(drawer.locator('iframe')).toHaveAttribute('src', 'legal');
  await expect(page.frameLocator('[data-testid="manual-drawer"] iframe').getByRole('heading', { level: 1, name: 'Legal notice and privacy' })).toBeVisible();
  // CBCTScope Help: the index, as before
  await page.evaluate(eventScript(MANUAL_EVENT));
  await expect(drawer.locator('iframe')).toHaveAttribute('src', /^manual\/index\.html\?theme=dark/);
  expect(problems).toEqual([]);
  await ctx.close();
});

test('the desktop Help menu opens the Cite this software dialogue', async ({ browser, baseURL }) => {
  const ctx = await shellContext(browser);
  const page = await ctx.newPage();
  const problems = guardPage(page, new URL(baseURL as string).origin);
  await page.goto('/');
  await waitForVolume(page);
  await page.evaluate(eventScript(CITE_EVENT));
  const dialog = page.getByRole('dialog', { name: 'Cite this software' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('cite-bibtex')).toContainText('@software{');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(problems).toEqual([]);
  await ctx.close();
});

test('the desktop File menu reaches both openers and the Snapshot button, and does nothing where a control is absent', async ({ browser, baseURL }) => {
  const ctx = await shellContext(browser);
  const page = await ctx.newPage();
  const problems = guardPage(page, new URL(baseURL as string).origin);
  await page.goto('/');
  await waitForVolume(page);
  // Open a Single DICOM File…: the single-file picker (no directory attribute, one file)
  const [one] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(clickScript(FILE_INPUT))]);
  expect(one.isMultiple()).toBe(false);
  expect(await one.element().evaluate((el) => (el as Element).getAttribute('data-testid'))).toBe(FILE_INPUT);
  // Open DICOMDIR or DICOM Folder…: the folder picker
  const [folder] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(clickScript(FOLDER_INPUT))]);
  expect(await folder.element().evaluate((el) => (el as Element).getAttribute('data-testid'))).toBe(FOLDER_INPUT);
  // Save Snapshot…: the header's Snapshot button, which hands over one PNG
  const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(clickScript(SNAPSHOT_BUTTON))]);
  expect(download.suggestedFilename()).toMatch(/\.png$/i);
  // a control that is absent, or disabled, is left alone and nothing throws
  await page.evaluate(clickScript('no-such-control'));
  await page.evaluate((id) => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.setAttribute('disabled', ''), SNAPSHOT_BUTTON);
  let downloads = 0;
  page.on('download', () => (downloads += 1));
  await page.evaluate(clickScript(SNAPSHOT_BUTTON));
  await page.waitForTimeout(1000);
  expect(downloads).toBe(0);
  expect(problems).toEqual([]);
  await ctx.close();
});

test('while a read runs, the File menu opens no second picker, and Open comes back when it ends', async ({ browser, baseURL }) => {
  const ctx = await shellContext(browser);
  // hold every file read until the test lets go, so the read stays in progress
  await ctx.addInitScript(() => {
    const w = window as unknown as { __release: () => void; __reads: number };
    const hold = new Promise<void>((r) => (w.__release = r));
    w.__reads = 0;
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function (this: Blob) {
      w.__reads += 1;
      await hold;
      return read.call(this);
    };
  });
  const page = await ctx.newPage();
  const problems = guardPage(page, new URL(baseURL as string).origin);
  await page.goto('/');
  await waitForVolume(page);
  const open = page.locator('header').getByRole('button', { name: 'Open', exact: true });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(clickScript(FILE_INPUT))]);
  await chooser.setFiles({ name: 'radiograph.dcm', mimeType: 'application/dicom', buffer: Buffer.from(radiographBytes()) });
  await expect(open).toBeDisabled();
  await expect(page.getByTestId(FILE_INPUT)).toBeDisabled();
  await expect(page.getByTestId(FOLDER_INPUT)).toBeDisabled();
  // both openers of the File menu: no picker opens while the read runs
  let choosers = 0;
  page.on('filechooser', () => (choosers += 1));
  await page.evaluate(clickScript(FILE_INPUT));
  await page.evaluate(clickScript(FOLDER_INPUT));
  await page.waitForTimeout(1000);
  expect(choosers).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __reads: number }).__reads)).toBe(1);
  // the read ends: Open and the File menu's openers work again
  await page.evaluate(() => (window as unknown as { __release: () => void }).__release());
  await expect(open).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByTestId(FILE_INPUT)).toBeEnabled();
  const [again] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(clickScript(FOLDER_INPUT))]);
  expect(again).toBeTruthy();
  expect(problems).toEqual([]);
  await ctx.close();
});

test('in the desktop app the version panel links the update page with this version after the #; on the website it does not', async ({ browser, baseURL, page }) => {
  const ctx = await shellContext(browser);
  const app = await ctx.newPage();
  await app.goto('/');
  await waitForVolume(app);
  await app.locator('header').getByRole('button', { name: /^v\d/ }).click();
  const link = app.getByRole('dialog', { name: 'About CBCTScope' }).getByRole('link', { name: 'Check for updates', exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', updateUrl(pkg.version));
  await expect(link).toHaveAttribute('href', `https://cbctscope.com/update#from=${pkg.version}`);
  await expect(link).toHaveAttribute('target', '_blank');
  await ctx.close();
  // the website: the popover is unchanged
  await page.goto(baseURL as string);
  await waitForVolume(page);
  await page.locator('header').getByRole('button', { name: /^v\d/ }).click();
  const popover = page.getByRole('dialog', { name: 'About CBCTScope' });
  await expect(popover).toBeVisible();
  await expect(popover.getByRole('link', { name: 'Check for updates' })).toHaveCount(0);
});

/** a strict version older than v (one step down in its last non-zero part), or null for 0.0.0 */
function olderThan(v: string): string | null {
  const [a, b, c] = v.split('.').map(Number);
  return c > 0 ? `${a}.${b}.${c - 1}` : b > 0 ? `${a}.${b - 1}.0` : a > 0 ? `${a - 1}.0.0` : null;
}
/** a strict version newer than v: the next major */
const newerThan = (v: string) => `${Number(v.split('.')[0]) + 1}.0.0`;

test('the test versions are strict and on the right side for every kind of version', () => {
  for (const v of ['0.0.1', '0.1.0', '1.0.0', '2.0.0', '2.1.0', '2.10.0', '3.0.5', pkg.version]) {
    const older = olderThan(v);
    expect(older, v).not.toBeNull();
    expect(versionFromHash(`#from=${older}`), v).toBe(older);
    expect(compareVersions(older as string, v), v).toBe(-1);
    expect(versionFromHash(`#from=${newerThan(v)}`), v).toBe(newerThan(v));
    expect(compareVersions(newerThan(v), v), v).toBe(1);
  }
  expect(olderThan('0.0.0')).toBeNull();
});

test('the update page says which version is newer, by the address after the #, and follows a change of it', async ({ page, baseURL }) => {
  const problems = guardPage(page, new URL(baseURL as string).origin);
  const newest = pkg.version;
  const status = page.getByTestId('update-status');
  const verdict = page.getByTestId('update-verdict');
  const note = page.getByText('This page read your version from the part of its address after the # sign, which browsers do not send to any server.');
  const download = page.getByRole('link', { name: 'Mac with Apple silicon' });

  // older
  const older = olderThan(newest) as string;
  await page.goto(`/update#from=${older}`);
  await expect(status).toHaveAttribute('data-state', 'older');
  await expect(verdict).toHaveText(`You have CBCTScope ${older}. The newest version is ${newest}.`);
  await expect(note).toBeVisible();
  await expect(download).toHaveAttribute('href', 'https://github.com/rezamotaghi/cbctscope/releases/latest/download/CBCTScope-mac-arm64.dmg');
  await expect(page.getByRole('link', { name: 'All downloads and release notes' })).toHaveAttribute('href', 'https://github.com/rezamotaghi/cbctscope/releases/latest');
  await expect(page.getByText('Your marks and settings are kept in the app', { exact: false })).toBeVisible();
  await expect(page.getByText('with the portable build, replace the old portable file with the new one', { exact: false })).toBeVisible();

  // same, through a hashchange on the same page
  await page.evaluate((v) => (window.location.hash = `from=${v}`), newest);
  await expect(status).toHaveAttribute('data-state', 'same');
  await expect(verdict).toHaveText(`You have the newest version of CBCTScope, ${newest}.`);
  await expect(note).toBeVisible();
  await expect(download).toHaveCount(0);

  // newer than the site knows
  const newer = newerThan(newest);
  await page.evaluate((v) => (window.location.hash = `from=${v}`), newer);
  await expect(status).toHaveAttribute('data-state', 'newer');
  await expect(verdict).toHaveText(`You have CBCTScope ${newer}. This page knows ${newest} as the newest release.`);
  await expect(note).toBeVisible();
  await expect(download).toHaveCount(0);

  // no version, or one that is not strict: the newest version and the downloads, no note, no raw text
  for (const hash of ['', '#from=2.1', '#from=<b>x</b>', '#from=9.9.9-beta']) {
    await page.goto(`/update${hash}`);
    await expect(status).toHaveAttribute('data-state', 'unknown');
    await expect(verdict).toHaveText(`The newest version of CBCTScope is ${newest}.`);
    await expect(note).toHaveCount(0);
    await expect(download).toBeVisible();
    await expect(page.locator('body')).not.toContainText('beta');
    await expect(page.locator('body')).not.toContainText('<b>');
  }
  await expect(page.getByText('Research use only. Not a medical device.')).toBeVisible();
  expect(problems).toEqual([]);
});

test('the update page without JavaScript names the newest version and offers the downloads', async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${baseURL}/update#from=0.0.1`);
  await expect(page.getByText(`The newest version of CBCTScope is ${pkg.version}.`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Windows', exact: true })).toHaveAttribute('href', 'https://github.com/rezamotaghi/cbctscope/releases/latest/download/CBCTScope-windows-setup.exe');
  await ctx.close();
});

test('inside the desktop app the update page gives no verdict and points to the menu item and the website', async ({ browser, baseURL }) => {
  const ctx = await shellContext(browser);
  const page = await ctx.newPage();
  const problems = guardPage(page, new URL(baseURL as string).origin);
  await page.goto('/update#from=0.0.1');
  const status = page.getByTestId('update-status');
  await expect(status).toHaveAttribute('data-state', 'in-app');
  await expect(status).toContainText('Check for Updates…');
  await expect(page.getByTestId('update-verdict')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Mac with Apple silicon' })).toHaveCount(0);
  const link = page.getByRole('link', { name: 'Open the update page on cbctscope.com' });
  await expect(link).toHaveAttribute('href', `https://cbctscope.com/update#from=${pkg.version}`);
  await expect(link).toHaveAttribute('target', '_blank');
  expect(problems).toEqual([]);
  await ctx.close();
});
