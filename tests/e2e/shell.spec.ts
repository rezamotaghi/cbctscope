// The reading screen's shell end to end: the header row, the status line, the side rail, the
// menus and the dialogues, at the widths a reader meets (docs/manual/03-interface.md).
import { expect, test, type Page } from '@playwright/test';
import { guardPage, viewModeLabels, waitForVolume } from './helpers';

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
    const dl = header.getByRole('button', { name: 'Download the desktop app' });
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
    // the Keys card open: its lines wrap inside it, and the page still never scrolls sideways
    await page.locator('header').getByRole('button', { name: 'Keys', exact: true }).click();
    const card = page.getByRole('dialog', { name: 'Keys' });
    await expect(card).toBeVisible();
    const withCard = await page.evaluate(() => {
      const c = document.querySelector('[role="dialog"][aria-label="Keys"]') as HTMLElement;
      const r = c.getBoundingClientRect();
      return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, card: c.scrollWidth - c.clientWidth, left: r.left, right: r.right };
    });
    expect(withCard.page, 'horizontal page overflow with the Keys card open').toBeLessThanOrEqual(0);
    expect(withCard.card, 'Keys card content wider than the card').toBeLessThanOrEqual(0);
    expect(withCard.left).toBeGreaterThanOrEqual(0);
    expect(withCard.right).toBeLessThanOrEqual(width);
  });

  test(`at ${width} px every pane button lies inside the viewport`, async ({ page }) => {
    await load(page, width, 844);
    await expect(page.locator('main [data-overlay="buttons"] button').first()).toBeVisible({ timeout: 60_000 });
    // the eraser row too: its buttons are the widest the 3D pane carries
    await page.locator('main').getByRole('button', { name: 'Eraser', exact: true }).click();
    await expect(page.locator('main').getByRole('button', { name: 'Revert', exact: true })).toBeVisible();
    const outside = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      return Array.from(document.querySelectorAll<HTMLElement>('main [data-pane] button, main [data-pane] input'))
        .filter((b) => b.closest('[data-pane]')?.getAttribute('data-pane') && getComputedStyle(b).visibility !== 'hidden')
        .map((b) => ({ name: b.getAttribute('aria-label') || b.textContent?.trim() || b.tagName, r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5))
        .map(({ name, r }) => `${name} at ${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)}`);
    });
    expect(outside).toEqual([]);
  });
}

test('below 768 px on a computer the viewer stays mounted under a full-contrast notice, and widening removes the notice without a remount', async ({ page }) => {
  await load(page, 700, 900);
  const notice = page.getByTestId('narrow-notice');
  await expect(notice).toBeVisible();
  // the mouse wording only: the touch wording is in the document but not displayed
  await expect(notice).toHaveText(
    'This window is too narrow to read in. Widen it to at least 768 px, or zoom out with Ctrl or Command and the minus key.',
    { useInnerText: true },
  );
  expect(await notice.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(230, 233, 239)');
  await expect(page.getByTestId('phone-landing')).toHaveCount(0);
  // read first: it precedes the header in the document, and shows under the header, above the panes
  expect(await notice.evaluate((n) => !!(n.compareDocumentPosition(document.querySelector('header')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  const nb = (await notice.boundingBox())!;
  const hb = (await page.locator('header').boundingBox())!;
  expect(nb.y).toBeGreaterThanOrEqual(hb.y + hb.height - 0.5);
  expect(nb.y).toBeLessThan((await page.locator('main').boundingBox())!.y);
  // reading state a remount would lose: a mode chosen, and a mark on the viewer's own element
  await page.locator('header').getByRole('button', { name: 'Grid', exact: true }).click();
  await page.locator('main').evaluate((m) => (m.dataset.probe = 'kept'));
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(notice).toBeHidden();
  await page.setViewportSize({ width: 600, height: 900 });
  await expect(notice).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(notice).toBeHidden();
  await expect(page.locator('main')).toHaveAttribute('data-probe', 'kept');
  await expect(page.locator('header').getByRole('button', { name: 'Grid', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('main canvas').first()).toBeVisible();
});

test('at 700 px on a computer the Open menu stays inside the viewport and the agent and download controls are reachable', async ({ page }) => {
  await load(page, 700, 900);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  const menu = (await page.getByRole('menu', { name: 'Open' }).boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(700);
  await page.keyboard.press('Escape');
  for (const name of ['Agent', 'Download the desktop app']) {
    const b = page.locator('header').getByRole('button', { name, exact: true });
    await expect(b, name).toBeVisible();
    const box = (await b.boundingBox())!;
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(700);
  }
  await page.locator('header').getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByTestId('agent-panel')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
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

/** draw on the axial pane with the tool on `key`: a drag, or clicks where the tool takes clicks */
async function drawOnAxial(page: Page, key: string, kind: 'drag' | 'angle' | 'freehand', at: number) {
  await page.keyboard.press(key);
  const pane = page.locator('main [data-pane]').filter({ has: page.locator('[data-overlay="label"]', { hasText: /^AXIAL\b/ }) });
  const box = (await pane.boundingBox())!;
  const x = (f: number) => box.x + box.width * f;
  const y = (f: number) => box.y + box.height * f;
  if (kind === 'angle') {
    for (const [fx, fy] of [[0.3, at], [0.45, at + 0.08], [0.6, at]]) {
      await page.mouse.click(x(fx), y(fy));
      await page.waitForTimeout(150);
    }
    return;
  }
  await page.mouse.move(x(0.3), y(at));
  await page.mouse.down();
  if (kind === 'freehand') {
    for (const [fx, fy] of [[0.4, at + 0.06], [0.5, at], [0.6, at + 0.06]]) await page.mouse.move(x(fx), y(fy), { steps: 6 });
  } else {
    await page.mouse.move(x(0.5), y(at + 0.04), { steps: 6 });
    await page.mouse.move(x(0.6), y(at + 0.08), { steps: 6 });
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test('no control anywhere on the page carries an emoji, a pictograph or an arrow character', async ({ page }) => {
  await load(page, 1440);
  // every control in the document, the image area included
  const scan = () =>
    page.evaluate(() => {
      const bad = /[\p{Extended_Pictographic}←-⇿⌀-⏿■-◿☀-➿⟰-⟿⤀-⥿⦀-⧿⬀-⯿〰]/u;
      const hits: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll('button, a, select, option, optgroup, label, [role="menuitem"]'))) {
        const text = (el.textContent ?? '') + ' ' + (el.getAttribute('label') ?? '') + ' ' + (el.getAttribute('aria-label') ?? '');
        if (bad.test(text)) hits.push(text.trim().slice(0, 60));
      }
      return hits;
    });
  expect(await scan()).toEqual([]);
  for (const name of ['Open', 'Help', 'Keys', 'Agent', 'Download the desktop app']) {
    await page.locator('header').getByRole('button', { name, exact: true }).click();
    expect(await scan(), `with ${name} open`).toEqual([]);
    await page.keyboard.press('Escape');
  }
  // one of each annotation kind in MPR, and a 3D ROI: every row of the objects list is scanned
  await expect(page.locator('main [data-overlay="label"]').first()).toHaveText(/\d+\/\d+/, { timeout: 60_000 });
  page.on('dialog', (d) => void d.accept('note'));
  await drawOnAxial(page, '3', 'drag', 0.2); // Length
  await drawOnAxial(page, '4', 'angle', 0.3); // Angle
  await drawOnAxial(page, '5', 'drag', 0.42); // Arrow (its label is prompted)
  await drawOnAxial(page, '6', 'drag', 0.5); // Text (its label is prompted)
  await drawOnAxial(page, '7', 'drag', 0.58); // Rect ROI
  await drawOnAxial(page, '8', 'drag', 0.66); // Ellipse ROI
  await drawOnAxial(page, '9', 'freehand', 0.74); // Freehand
  await drawOnAxial(page, '0', 'drag', 0.1); // 3D ROI
  const list = page.getByTestId('objects-list');
  await expect(list).toBeVisible();
  await expect(list.getByRole('button', { name: /^3D ROI / })).toHaveCount(1, { timeout: 15_000 });
  await expect(list.getByRole('button', { name: /^Length / })).toHaveCount(1);
  await expect(list.getByRole('button', { name: /^Rect ROI / })).toHaveCount(1);
  expect(await scan(), 'with the objects list').toEqual([]);
});

test('the version popover names the author as a link to his site', async ({ page }) => {
  await page.goto('/');
  await waitForVolume(page);
  await page.locator('header').getByRole('button', { name: /^v\d/ }).click();
  const popover = page.getByRole('dialog', { name: 'About CBCTScope' });
  const author = popover.getByRole('link', { name: 'Dr. Reza Motaghi', exact: true });
  await expect(author).toHaveCount(1);
  await expect(author).toHaveAttribute('href', 'https://rezamotaghi.com');
  await expect(author).toHaveAttribute('target', '_blank');
  await expect(author).toHaveAttribute('rel', 'noopener noreferrer');
  // its notes line up with the name: a menu's note padding does not reach a popover
  const lefts = await popover.evaluate((d) => [d.firstElementChild!, ...Array.from(d.querySelectorAll('.note'))].map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(lefts.length).toBeGreaterThan(1);
  expect(new Set(lefts).size, `left edges ${lefts.join(', ')}`).toBe(1);
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

test('the Keys card lists a Mouse section in every mode, and never sends the reader to the status line', async ({ page }) => {
  await load(page, 1440);
  const header = page.locator('header');
  const card = page.getByRole('dialog', { name: 'Keys' });
  for (const mode of viewModeLabels()) {
    await header.getByRole('button', { name: mode, exact: true }).click();
    await header.getByRole('button', { name: 'Keys', exact: true }).click();
    const mouse = card.getByTestId('keys-mouse');
    await expect(mouse, mode).toBeVisible();
    await expect(mouse.locator('.pop-head')).toHaveText('Mouse');
    // the shared line and at least one of this mode's own gestures
    await expect(mouse).toContainText('Double-click a slider: reset it');
    expect(await mouse.locator('div').filter({ hasText: /^[^:]+: .+$/ }).count(), mode).toBeGreaterThan(1);
    await expect(card).not.toContainText('status line');
    await page.keyboard.press('Escape');
  }
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
  await expect(line.getByTestId('status-legend')).toHaveText(
    'Wheel: move the slice. Left-click: place the crosshairs. Right-drag: rotate the section. All gestures: Keys.',
  );
  // the phantom is named once, in the volume list
  await expect(page.locator('header select option:checked')).toContainText('Geometric test phantom');
  await expect(line).not.toContainText('phantom');
  // the header still holds no case facts
  await expect(page.locator('header')).not.toContainText('µm');
});

for (const width of [1024, 1280, 1440]) {
  test(`at ${width} px the status line's legend is never cut, in any mode`, async ({ page }) => {
    await load(page, width);
    const header = page.locator('header');
    const legend = page.getByTestId('status-legend');
    for (const mode of viewModeLabels()) {
      await header.getByRole('button', { name: mode, exact: true }).click();
      await expect(legend).toHaveText(/ All gestures: Keys\.$/);
      const m = await legend.evaluate((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          sw: el.scrollWidth,
          cw: el.clientWidth,
          sh: el.scrollHeight,
          ch: el.clientHeight,
          overflow: cs.textOverflow,
          title: el.getAttribute('title'),
          right: r.right,
          text: el.textContent ?? '',
        };
      });
      expect(m.sw, `${mode}: legend scrollWidth over clientWidth`).toBeLessThanOrEqual(m.cw);
      expect(m.sh, `${mode}: legend scrollHeight over clientHeight`).toBeLessThanOrEqual(m.ch);
      expect(m.overflow, mode).not.toBe('ellipsis');
      expect(m.title, `${mode}: no title-only text`).toBeNull();
      expect(m.right).toBeLessThanOrEqual(width);
      // at most three gestures before the pointer to the Keys card
      expect(m.text.replace(/ All gestures: Keys\.$/, '').split('. ').length, mode).toBeLessThanOrEqual(3);
    }
  });
}

test('the viewer keys wait while a modal dialogue is open', async ({ page }) => {
  await load(page, 1440);
  /** press a key on the focused element; true when a viewer handler took it */
  const taken = (key: string) =>
    page.evaluate((k) => {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      (document.activeElement ?? document.body).dispatchEvent(ev);
      return ev.defaultPrevented;
    }, key);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  expect(await taken('n'), 'N without a dialogue').toBe(true);
  expect(await taken('p'), 'P without a dialogue').toBe(true);
  await page.locator('header').getByTestId('agent-status').click();
  const strip = page.getByTestId('agent-panel');
  await strip.getByRole('button', { name: 'Set up the navigation agent' }).click();
  await strip.getByLabel('Provider').selectOption({ label: 'Model server on this computer' });
  await strip.getByLabel('Model name').fill('any-model');
  await strip.getByRole('button', { name: 'Switch on…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Switch on the navigation agent' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  for (const key of ['n', 'p', 'N', '3', 'w', 'r', 'v']) expect(await taken(key), `${key} behind the dialogue`).toBe(false);
  // the tool did not change behind it
  await expect(page.locator('aside').getByRole('button', { name: 'Crosshairs', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});
