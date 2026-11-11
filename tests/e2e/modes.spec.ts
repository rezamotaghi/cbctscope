// The interface grammar inside the reading modes (docs/manual/03-interface.md): every mode
// on the phantom, with its toolbar in use, scanned end to end. The header and the side rail
// have their own checks in shell.spec.ts; this one walks the whole document in each mode,
// so a control a mode draws itself cannot keep the old look or wording unnoticed.
import { expect, test, type Page } from '@playwright/test';
import { guardPage, viewModeLabels, waitForVolume } from './helpers';

let problems: string[] = [];

test.beforeEach(async ({ page, baseURL }) => {
  problems = guardPage(page, new URL(baseURL as string).origin);
});

test.afterEach(() => {
  expect(problems).toEqual([]);
});

/** the accent (globals.css --accent) and the control border (--ctl-border) as computed colours */
const ACCENT = 'rgb(76, 141, 255)';
const CTL_BORDER = 'rgb(107, 115, 132)';

/**
 * Words that may start a caption in lower case: units after a number that wrapped onto a
 * line of its own, and the version chip (v2.0.0). Everything else a reader sees starts with
 * a capital, a digit or a sign.
 */
const LOWER_OK = ['mm', 'cm', 'px', 'ms', 'v'];

/** the mode switch, as a button or as a tab */
async function openMode(page: Page, label: string) {
  const header = page.locator('header');
  await header.getByRole('button', { name: label, exact: true }).or(header.getByRole('tab', { name: label, exact: true })).click();
}

/** a point on the axial scout pane of the current mode, as fractions of its canvas */
async function axialPoint(page: Page, fx: number, fy: number): Promise<[number, number]> {
  const canvas = page.locator('main [data-pane="axial"] canvas').first();
  const box = (await canvas.boundingBox())!;
  return [box.x + box.width * fx, box.y + box.height * fy];
}

async function dragOnAxial(page: Page, from: [number, number], to: [number, number]) {
  const a = await axialPoint(page, ...from);
  const b = await axialPoint(page, ...to);
  await page.mouse.move(...a);
  await page.mouse.down();
  await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 6 });
  await page.mouse.move(...b, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** put each mode's toolbar to work, where the suite knows how */
const USE: Record<string, (page: Page) => Promise<void>> = {
  Pano: async (page) => {
    await page.getByRole('button', { name: 'Auto arch', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Add nerve', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Done tracing', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Measure', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Measure', exact: true })).toHaveAttribute('aria-pressed', 'true');
  },
  TMJ: async (page) => {
    await dragOnAxial(page, [0.3, 0.5], [0.42, 0.5]);
    await expect(page.getByRole('button', { name: 'Clear lines', exact: true })).toBeEnabled();
  },
  Reslice: async (page) => {
    await dragOnAxial(page, [0.3, 0.5], [0.7, 0.55]);
    const end = await axialPoint(page, 0.7, 0.55);
    await page.mouse.dblclick(...end);
    await page.waitForTimeout(800);
    await expect(page.getByText('Draw a line or curve on the scout, and the resliced stack appears here')).toHaveCount(0);
  },
  Region: async (page) => {
    await dragOnAxial(page, [0.3, 0.3], [0.7, 0.7]);
    await expect(page.getByRole('button', { name: 'Clear box', exact: true })).toBeEnabled();
    const seed = await axialPoint(page, 0.5, 0.5);
    await page.mouse.click(...seed);
    await page.waitForTimeout(1500);
  },
  Ceph: async (page) => {
    await page.getByRole('button', { name: 'Auto contrast', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Auto contrast', exact: true })).toHaveAttribute('aria-pressed', 'true');
  },
};

/** everything the scan objects to, as readable lines */
async function scanDocument(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ ACCENT, CTL_BORDER, LOWER_OK }) => {
      const out: string[] = [];
      const glyph = /[\p{Extended_Pictographic}←-⇿⌀-⏿■-◿☀-➿⟰-⟿⤀-⥿⦀-⧿⬀-⯿〰✓✔]/u;
      const skip = 'script, style, noscript, code, kbd, svg, [aria-hidden="true"]';
      const visible = (el: Element) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      };
      const where = (el: Element) => (el.closest('header') ? 'header' : el.closest('aside') ? 'rail' : el.closest('main') ? 'main' : 'page');
      const firstWordOk = (text: string) => {
        const t = text.trim();
        if (!t || !/^[a-z]/.test(t)) return true;
        const word = t.match(/^[a-z]+/)![0];
        if (word === 'v') return /^v\d/.test(t); // the version, never a word
        return LOWER_OK.includes(word);
      };

      // 1. captions: the first words an element shows, wherever they sit. A control (button,
      // tab, option, label, link, menu row) is read whole; any other element by its first
      // own text, when nothing else comes before it, so a value in the middle of a caption
      // ("Spacing 2.0 mm") is never mistaken for its start.
      const controls = 'button, [role="tab"], [role="menuitem"], option, optgroup, label, a, summary, legend';
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        if (el.closest(skip)) continue;
        const isControl = el.matches(controls);
        if (!isControl && !visible(el)) continue;
        if (isControl && !el.matches('option, optgroup') && !visible(el)) continue;
        let text = '';
        if (isControl) text = el.matches('optgroup') ? (el.getAttribute('label') ?? '') : (el.textContent ?? '');
        else {
          for (const n of Array.from(el.childNodes)) {
            if (n.nodeType === Node.TEXT_NODE) {
              if ((n.textContent ?? '').trim()) {
                text = n.textContent ?? '';
                break;
              }
            } else if (n.nodeType === Node.ELEMENT_NODE && ((n as Element).textContent ?? '').trim()) break; // something else leads
          }
          if (!text) continue;
          // a text that continues a parent's caption is the parent's business
          if (el.parentElement && el.parentElement.closest(controls)) continue;
        }
        const t = text.replace(/\s+/g, ' ').trim();
        if (!t) continue;
        if (!firstWordOk(t)) out.push(`${where(el)}: lowercase start "${t.slice(0, 50)}"`);
        // the slice direction in a pane label (AXIAL 12/240 S→I) is notation, not an icon
        if (glyph.test(t) && !el.closest('[data-overlay="label"]')) out.push(`${where(el)}: glyph in "${t.slice(0, 50)}"`);
      }

      // 2. selection: one signal, the solid accent
      for (const el of Array.from(document.body.querySelectorAll('[aria-pressed="true"], [aria-selected="true"]'))) {
        if (!visible(el)) continue;
        const bg = getComputedStyle(el).backgroundColor;
        if (bg !== ACCENT) out.push(`${where(el)}: selected "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}" has background ${bg}`);
      }

      // 3. every bordered button wears the control border (a selected one may wear the accent)
      for (const el of Array.from(document.body.querySelectorAll('button'))) {
        if (!visible(el)) continue;
        const cs = getComputedStyle(el);
        if (cs.borderTopStyle === 'none' || parseFloat(cs.borderTopWidth) === 0) continue;
        const c = cs.borderTopColor;
        const selected = el.getAttribute('aria-pressed') === 'true';
        if (c !== CTL_BORDER && !(selected && c === ACCENT)) {
          out.push(`${where(el)}: button "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}" has border ${c}`);
        }
      }
      return out;
    },
    { ACCENT, CTL_BORDER, LOWER_OK },
  );
}

test('in every reading mode, with its toolbar in use, every caption starts with a capital, no control carries a glyph, a selected control is solid accent, and every button wears the control border', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await waitForVolume(page);
  const modes = viewModeLabels();
  expect(modes).toHaveLength(8);
  const found: string[] = [];
  for (const mode of modes) {
    await openMode(page, mode);
    await expect(page.locator('main canvas').first()).toBeVisible({ timeout: 60_000 });
    // the mode's volume is on screen: its loading veil has gone
    await expect(page.locator('main').getByText(/^Loading volume/)).toHaveCount(0, { timeout: 60_000 });
    await page.waitForTimeout(500);
    found.push(...(await scanDocument(page)).map((p) => `${mode} at rest, ${p}`));
    if (USE[mode]) {
      await USE[mode](page);
      found.push(...(await scanDocument(page)).map((p) => `${mode} in use, ${p}`));
    }
  }
  expect([...new Set(found)]).toEqual([]);
});
