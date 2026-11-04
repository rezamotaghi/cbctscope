// The manual's pages (scripts/manual-html.mjs, docs/web-build.md, section 13): generated from
// the markdown into a temporary folder and checked as a reader would meet them. One page per
// manifest entry, every link between pages lands on a generated file and heading, every still
// is there, no page carries an em dash, the search index covers every heading, and the help
// drawer addresses those same pages.
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';
import ManualDrawer, { drawerSrc, guidePage, manualHref } from '../components/cbct/ManualDrawer';
import { pageName, writeManual } from '../scripts/manual-html.mjs';

const root = process.cwd();
const out = mkdtempSync(path.join(os.tmpdir(), 'cbctscope-manual-'));
writeManual({ root, outDir: out });
afterAll(() => rmSync(out, { recursive: true, force: true }));

const manifest = JSON.parse(readFileSync(path.join(root, 'docs/manual/manifest.json'), 'utf8')) as {
  chapters: { file: string; title: string }[];
};
const pages = readdirSync(out).filter((f) => f.endsWith('.html'));
const html = (p: string) => readFileSync(path.join(out, p), 'utf8');
const ids = (p: string) => new Set([...html(p).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
const headingIds = (p: string) => [...html(p).matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]);
const appSrc = readFileSync(path.join(root, 'components/cbct/CbctApp.tsx'), 'utf8');
const modes = [...(appSrc.match(/type ViewMode = ([^;]+);/)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1]);

describe('the manual as pages', () => {
  it('renders one page per manifest entry, plus the index', () => {
    const expected = manifest.chapters.map((c) => pageName(c.file) as string);
    expect(new Set(expected).size).toBe(manifest.chapters.length);
    expect(pages.sort()).toEqual([...expected, 'index.html'].sort());
  });

  it('lists every manifest title in each page table of contents, in order', () => {
    for (const p of pages) {
      const nav = /<nav class="toc"[\s\S]*?<\/nav>/.exec(html(p))?.[0] ?? '';
      expect(nav, `${p} has the phone-width Contents button`).toContain('aria-controls="toc-list"');
      const titles = [...nav.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
      expect(titles, p).toEqual(manifest.chapters.map((c) => c.title));
    }
  });

  it('every internal link resolves to a generated file and, with an anchor, to a heading there', () => {
    const broken: string[] = [];
    for (const p of pages) {
      for (const m of html(p).matchAll(/<a [^>]*href="([^"]+)"/g)) {
        const href = m[1];
        if (/^[a-z]+:/i.test(href)) continue;
        const [file, hash] = href.split('#');
        const target = file || p;
        if (!existsSync(path.join(out, target))) broken.push(`${p}: ${href}`);
        else if (hash && !ids(target).has(hash)) broken.push(`${p}: ${href} (no such heading)`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('every still a page references exists, and none is remote', () => {
    let count = 0;
    for (const p of pages) {
      for (const m of html(p).matchAll(/<img [^>]*src="([^"]+)"/g)) {
        count += 1;
        expect(m[1], `${p} loads a remote image`).not.toMatch(/^[a-z]+:|^\/\//i);
        expect(existsSync(path.join(out, m[1])), `${p}: ${m[1]}`).toBe(true);
      }
    }
    expect(count).toBeGreaterThanOrEqual(9); // the header still and the eight mode stills
  });

  it('no page carries an em or en dash', () => {
    for (const p of [...pages, 'manual.css', 'manual.js', 'search-index.json']) expect(html(p), p).not.toMatch(/[—–]/);
  });

  it('the search index covers every heading of every page', () => {
    const index = JSON.parse(html('search-index.json')) as { pages: { p: string; t: string }[]; entries: { i: number; id: string; h: string }[] };
    expect(index.pages.map((x) => x.t)).toEqual(manifest.chapters.map((c) => c.title));
    for (const [i, { p }] of index.pages.entries()) {
      const indexed = new Set(index.entries.filter((e) => e.i === i).map((e) => e.id));
      for (const id of headingIds(p)) expect(indexed.has(id), `${p}#${id} is not in the search index`).toBe(true);
    }
  });

  it('pages are CSP-ready: a charset to anchor the policy, no inline script, nothing off-origin loaded', () => {
    for (const p of pages) {
      const page = html(p);
      expect(page, p).toMatch(/<meta charset="utf-8">/i);
      expect(page, `${p} has an inline script`).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      for (const m of page.matchAll(/<(?:script|link|img)[^>]*(?:src|href)="([^"]+)"/g)) expect(m[1], p).not.toMatch(/^[a-z]+:|^\/\//i);
    }
  });

  it('the index page states the version and the manual revision', () => {
    const version = (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;
    const revision = /\|\s*Manual revision\s*\|\s*([^|]+?)\s*\|/.exec(readFileSync(path.join(root, 'docs/manual/00-front.md'), 'utf8'))?.[1];
    expect(revision).toBeTruthy();
    expect(html('index.html')).toContain(version);
    expect(html('index.html')).toContain(revision as string);
  });
});

describe('the help drawer', () => {
  it('every mode guide and the radiographs section are generated pages', () => {
    expect(modes.length).toBeGreaterThanOrEqual(8);
    for (const mode of modes) expect(existsSync(path.join(out, guidePage(mode, false))), mode).toBe(true);
    const [file, hash] = guidePage('mpr', true).split('#');
    expect(ids(file).has(hash)).toBe(true);
  });

  it('shows the page relative to the viewer, with a close button', () => {
    expect(manualHref('index.html')).toBe('manual/index.html');
    const markup = renderToStaticMarkup(createElement(ManualDrawer, { page: 'mpr.html', onClose: () => {} }));
    expect(markup).toContain('src="manual/mpr.html?theme=dark"');
    expect(drawerSrc(guidePage('mpr', true))).toBe('manual/04-opening-scans.html?theme=dark#45-2d-radiographs');
    expect(markup).toContain('title="CBCTScope user manual"');
    expect(markup).toMatch(/<button[^>]*>Close manual/);
    expect(markup).toContain('aria-label="User manual"');
  });
});
