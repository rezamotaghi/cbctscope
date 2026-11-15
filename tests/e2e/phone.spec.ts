// The phone page (components/SiteIntro.tsx and components/phone.ts; docs/web-build.md section 7;
// manual section 2.1), in touch contexts: a coarse pointer that cannot hover, as Chromium's
// mobile emulation reports it (checked with matchMedia before anything relies on it). On a
// phone, in either orientation, the viewer never mounts and its code, WASM and volume are never
// requested. The line is 600 px on the shorter side: phones end near 440 px, so every tablet,
// the iPad mini's 744 by 1133 included, gets the viewer.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { guardPage, waitForVolume } from './helpers';

const HOME_LEAD =
  'CBCTScope is a CBCT and 2D radiograph viewer made by Reza Motaghi, a board-certified oral and maxillofacial radiologist.';
const COMPUTER = 'CBCTScope reads scans on a computer. Open cbctscope.com there.';
const CONTROLS: [string, string][] = [
  ['User manual', 'manual/index.html'],
  ['Desktop app downloads', 'https://github.com/rezamotaghi/cbctscope/releases/latest'],
  ['Send this link to myself', 'mailto:?subject=CBCTScope&body=https%3A%2F%2Fcbctscope.com'],
];

/** a touch context at a size, with the off-origin guard and every request the page makes */
async function touch(browser: Browser, baseURL: string, width: number, height: number, javaScriptEnabled = true) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, javaScriptEnabled });
  const page = await ctx.newPage();
  const problems = guardPage(page, new URL(baseURL).origin);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  return { ctx, page, problems, requests };
}

/** the emulation is what the page's media query expects of a phone */
async function expectPhoneMedia(page: Page) {
  const m = await page.evaluate(() => ({
    coarse: matchMedia('(pointer: coarse)').matches,
    noHover: matchMedia('(hover: none)').matches,
  }));
  expect(m, 'the touch context reports a coarse pointer that cannot hover').toEqual({ coarse: true, noHover: true });
}

/** the page has loaded and its scripts have run: nothing more is on its way */
async function settled(page: Page) {
  await page.waitForLoadState('networkidle');
}

const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('a phone at 375 x 812 gets the phone page: one heading, the lead, the picture, three controls, and not one request for the viewer', async ({ browser, baseURL }) => {
  const { ctx, page, problems, requests } = await touch(browser, baseURL as string, 375, 812);
  await page.goto('/');
  await expectPhoneMedia(page);
  const landing = page.getByTestId('phone-landing');
  await expect(landing).toBeVisible();
  await settled(page);
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('header, aside')).toHaveCount(0);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('CBCTScope');
  await expect(page.getByRole('main')).toContainText(HOME_LEAD);
  await expect(page.getByText('The viewer is loading.')).toBeHidden();
  await expect(landing).toContainText(COMPUTER);
  const controls = landing.locator('.phone-action');
  await expect(controls).toHaveText(CONTROLS.map(([label]) => label));
  for (const [i, [label, href]] of CONTROLS.entries()) {
    const c = controls.nth(i);
    await expect(c, label).toHaveAttribute('href', href);
    const box = (await c.boundingBox())!;
    expect(box.height, `${label} height`).toBeGreaterThanOrEqual(44);
    expect(box.width, `${label} width`).toBeGreaterThanOrEqual(375 - 2 * 16 - 1);
    expect(await c.evaluate((el) => getComputedStyle(el).color), `${label} colour`).toBe('rgb(230, 233, 239)');
  }
  await expect(controls.nth(1)).toHaveAttribute('target', '_blank');
  const img = landing.getByRole('img');
  expect((await img.getAttribute('alt'))!.length).toBeGreaterThan(40);
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBe(1200);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  // every request is the page itself, what its HTML names, or the picture: no chunk loaded later
  // (the viewer's code), no WASM, no worker, no volume
  const html = await (await page.request.get('/')).text();
  const named = new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, '&'), baseURL as string).href));
  const origin = new URL(baseURL as string).origin;
  const extra = requests.filter((u) => {
    const url = new URL(u);
    return !(url.href === `${origin}/` || named.has(url.href) || url.pathname === '/phone-mpr.webp' || url.pathname === '/favicon.ico');
  });
  expect(extra, 'requests the served HTML does not name').toEqual([]);
  expect(requests.filter((u) => /\.wasm\b/.test(u))).toEqual([]);
  expect(problems).toEqual([]);
  await ctx.close();
});

test('a phone in landscape at 812 x 375 still gets the phone page, and rotating never mounts the viewer', async ({ browser, baseURL }) => {
  const { ctx, page, problems } = await touch(browser, baseURL as string, 812, 375);
  await page.goto('/');
  await expectPhoneMedia(page);
  await expect(page.getByTestId('phone-landing')).toBeVisible();
  await settled(page);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  for (const [w, h] of [
    [375, 812],
    [812, 375],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await expect(page.getByTestId('phone-landing')).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(await sideways(page), `sideways at ${w} x ${h}`).toBeLessThanOrEqual(0);
  }
  expect(problems).toEqual([]);
  await ctx.close();
});

for (const [width, height] of [
  [320, 568],
  [430, 932],
] as const) {
  test(`a phone at ${width} x ${height}: no sideways scroll, nothing clipped`, async ({ browser, baseURL }) => {
    const { ctx, page, problems } = await touch(browser, baseURL as string, width, height);
    await page.goto('/');
    await expect(page.getByTestId('phone-landing')).toBeVisible();
    await settled(page);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    const outside = await page.evaluate(
      (w) =>
        Array.from(document.querySelectorAll<HTMLElement>('[data-testid="site-intro"] *'))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && (r.left < -0.5 || r.right > w + 0.5)).length,
      width,
    );
    expect(outside).toBe(0);
    expect(problems).toEqual([]);
    await ctx.close();
  });
}

test('without scripts a phone is served the phone page from the first paint', async ({ browser, baseURL }) => {
  const { ctx, page, problems } = await touch(browser, baseURL as string, 375, 812, false);
  await page.goto(baseURL as string);
  await expect(page.getByTestId('phone-landing')).toBeVisible();
  await expect(page.getByText('The viewer is loading.')).toBeHidden();
  await expect(page.getByText('The viewer needs JavaScript. The manual and the pages below do not.')).toBeHidden();
  await expect(page.getByRole('link', { name: 'MPR reading guide' })).toBeHidden();
  expect(problems).toEqual([]);
  await ctx.close();
});

test('a touch tablet of 1024 x 768 gets the viewer, without the narrow-window notice', async ({ browser, baseURL }) => {
  const { ctx, page, problems } = await touch(browser, baseURL as string, 1024, 768);
  await page.goto('/');
  await expectPhoneMedia(page);
  await waitForVolume(page);
  await expect(page.getByTestId('phone-landing')).toHaveCount(0);
  await expect(page.getByTestId('narrow-notice')).toBeHidden();
  expect(problems).toEqual([]);
  await ctx.close();
});

const TURN = 'This screen is too narrow to read in upright. Turn the device sideways.';

/** what of the viewer's header, pane buttons and open menus lies outside the viewport */
async function offScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    return Array.from(
      document.querySelectorAll<HTMLElement>('header button, header select, header a, main [data-pane] button, main [data-pane] input, [role="menu"]'),
    )
      .filter((el) => getComputedStyle(el).visibility !== 'hidden')
      .map((el) => ({ name: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.tagName, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5))
      .map(({ name, r }) => `${name} at ${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)}`);
  });
}

test('an iPad mini upright at 744 x 1133 gets the viewer under the turn-sideways notice, with nothing off the screen', async ({ browser, baseURL }) => {
  const { ctx, page, problems } = await touch(browser, baseURL as string, 744, 1133);
  await page.goto('/');
  await expectPhoneMedia(page);
  await waitForVolume(page);
  await expect(page.getByTestId('phone-landing')).toHaveCount(0);
  const notice = page.getByTestId('narrow-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(TURN, { useInnerText: true });
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await expect(page.locator('main [data-overlay="buttons"] button').first()).toBeVisible({ timeout: 60_000 });
  expect(await offScreen(page), 'with every menu closed').toEqual([]);
  // each of the header's menus, opened by a tap, stays on the screen
  const menus = page.locator('header [aria-haspopup="menu"]');
  const n = await menus.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const b = menus.nth(i);
    const name = (await b.getAttribute('aria-label')) || (await b.innerText());
    await b.tap();
    await expect(page.getByRole('menu').first(), name).toBeVisible();
    expect(await offScreen(page), `with ${name} open`).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  await expect(page.getByText(/Loading volume/)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('touch-744x1133.png') });
  expect(problems).toEqual([]);
  await ctx.close();
});

test('an iPad mini sideways at 1133 x 744 gets the viewer with no notice', async ({ browser, baseURL }) => {
  const { ctx, page, problems } = await touch(browser, baseURL as string, 1133, 744);
  await page.goto('/');
  await expectPhoneMedia(page);
  await waitForVolume(page);
  await expect(page.getByTestId('phone-landing')).toHaveCount(0);
  await expect(page.getByTestId('narrow-notice')).toBeHidden();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await expect(page.locator('main [data-overlay="buttons"] button').first()).toBeVisible({ timeout: 60_000 });
  expect(await offScreen(page)).toEqual([]);
  await expect(page.getByText(/Loading volume/)).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('touch-1133x744.png') });
  expect(problems).toEqual([]);
  await ctx.close();
});

test('a touch screen of 600 x 960, the line itself, gets the viewer', async ({ browser, baseURL }) => {
  const { ctx, page, problems } = await touch(browser, baseURL as string, 600, 960);
  await page.goto('/');
  await expectPhoneMedia(page);
  await waitForVolume(page);
  await expect(page.getByTestId('phone-landing')).toHaveCount(0);
  await expect(page.getByTestId('narrow-notice')).toHaveText(TURN, { useInnerText: true });
  expect(problems).toEqual([]);
  await ctx.close();
});

// every phone size, and one pixel under the line, upright and sideways: the phone page
for (const [w, h] of [
  [599, 960],
  [320, 568],
  [375, 812],
  [430, 932],
] as const) {
  for (const [width, height] of [
    [w, h],
    [h, w],
  ] as const) {
    test(`a touch screen of ${width} x ${height} gets the phone page`, async ({ browser, baseURL }) => {
      const { ctx, page, problems } = await touch(browser, baseURL as string, width, height);
      await page.goto('/');
      await expectPhoneMedia(page);
      await expect(page.getByTestId('phone-landing')).toBeVisible();
      await settled(page);
      await expect(page.locator('canvas')).toHaveCount(0);
      expect(problems).toEqual([]);
      await ctx.close();
    });
  }
}

// "Send this link to myself" (components/ShareLink.tsx): the share sheet where navigator.share
// exists, the mail link where it does not. The page's navigator.share is a stub that records its
// calls; a window listener in the bubble phase, after React's own, records whether the tap's
// default (following the mailto:) was prevented, then prevents it so no mail client is asked for.
type ShareMode = 'resolve' | 'abort' | 'absent';
async function shareTap(browser: Browser, baseURL: string, mode: ShareMode) {
  const t = await touch(browser, baseURL, 375, 812);
  await t.page.addInitScript((m: ShareMode) => {
    const w = window as unknown as { __shares: unknown[]; __defaults: boolean[] };
    w.__shares = [];
    w.__defaults = [];
    if (m === 'absent') {
      delete (Navigator.prototype as { share?: unknown }).share;
      delete (navigator as { share?: unknown }).share;
    } else {
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: (data: unknown) => {
          w.__shares.push(data);
          return m === 'abort' ? Promise.reject(new DOMException('Share canceled', 'AbortError')) : Promise.resolve();
        },
      });
    }
    window.addEventListener('click', (e) => {
      if (!(e.target as Element).closest('[data-testid="phone-mail"]')) return;
      w.__defaults.push(e.defaultPrevented);
      e.preventDefault();
    });
  }, mode);
  await t.page.goto('/');
  const link = t.page.getByTestId('phone-mail');
  await expect(link).toBeVisible();
  // hydrated: React has attached its props, and with them the click handler
  await expect.poll(() => link.evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps')))).toBe(true);
  const before = t.page.url();
  await link.tap();
  const record = () =>
    t.page.evaluate(() => {
      const w = window as unknown as { __shares: unknown[]; __defaults: boolean[] };
      return { __shares: w.__shares, __defaults: w.__defaults };
    });
  await expect.poll(async () => (await record()).__defaults.length).toBe(1);
  return { ...t, link, before, record };
}

test('with a share sheet, a tap shares the site address and title once and does not navigate', async ({ browser, baseURL }) => {
  const { ctx, page, problems, link, before, record } = await shareTap(browser, baseURL as string, 'resolve');
  const r = await record();
  expect(r.__shares).toEqual([{ title: 'CBCTScope', url: 'https://cbctscope.com' }]);
  expect(r.__defaults).toEqual([true]);
  expect(page.url()).toBe(before);
  await expect(link).toHaveAttribute('href', CONTROLS[2][1]);
  expect(problems).toEqual([]);
  await ctx.close();
});

test('a cancelled share sheet leaves the page where it is, with no mail link followed', async ({ browser, baseURL }) => {
  const { ctx, page, problems, before, record } = await shareTap(browser, baseURL as string, 'abort');
  const r = await record();
  expect(r.__shares).toHaveLength(1);
  expect(r.__defaults).toEqual([true]);
  await page.evaluate(() => new Promise((res) => setTimeout(res, 50)));
  expect(page.url()).toBe(before);
  await expect(page.getByTestId('phone-landing')).toBeVisible();
  expect(problems).toEqual([]);
  await ctx.close();
});

test('without navigator.share the control stays a plain mailto: link and the tap keeps its default', async ({ browser, baseURL }) => {
  const { ctx, problems, link, record } = await shareTap(browser, baseURL as string, 'absent');
  const r = await record();
  expect(r.__shares).toEqual([]);
  expect(r.__defaults, 'the link default was not prevented').toEqual([false]);
  await expect(link).toHaveAttribute('href', CONTROLS[2][1]);
  expect(problems).toEqual([]);
  await ctx.close();
});
