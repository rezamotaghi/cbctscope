// The manual drawer's list of pages (components/cbct/ManualDrawer.tsx MANUAL_PAGES) stays the
// manual's own: every page scripts/manual-html.mjs renders from docs/manual/manifest.json, plus
// the index. The desktop app's Help menu names a page in its window event; the drawer opens only
// a page it knows, or a site page it shows, and ignores anything else.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MANUAL_PAGES, menuDrawerPage } from '../components/cbct/ManualDrawer';
import { pageName } from '../scripts/manual-html.mjs';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'docs/manual/manifest.json'), 'utf8')) as { chapters: { file: string }[] };

describe('the pages the desktop menu may open in the drawer', () => {
  it('are the manifest pages and the index', () => {
    expect([...MANUAL_PAGES].sort()).toEqual(['index.html', ...manifest.chapters.map((c) => pageName(c.file) as string)].sort());
  });

  it('opens the index without a detail, a known page or site page by name, and nothing else', () => {
    expect(menuDrawerPage(undefined)).toBe('index.html');
    expect(menuDrawerPage(null)).toBe('index.html');
    expect(menuDrawerPage('12-shortcuts.html')).toBe('12-shortcuts.html');
    expect(menuDrawerPage('mpr.html')).toBe('mpr.html');
    expect(menuDrawerPage('legal')).toBe('legal');
    expect(menuDrawerPage('about')).toBe('about');
    for (const bad of ['', '13-missing.html', '../secret.html', 'https://example.com', 'javascript:alert(1)', '12-shortcuts.html#x', 'toString', '__proto__', 42, {}, ['legal']]) {
      expect(menuDrawerPage(bad), String(bad)).toBeNull();
    }
  });
});
