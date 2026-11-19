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
        // other origins, and the site's pages beside manual/ (../, ../about, ../legal: checked against the export in tests/siteExport.test.ts)
        if (/^[a-z]+:/i.test(href) || href.startsWith('../')) continue;
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

  it('pages are CSP-ready: a charset to anchor the policy, no executed inline script, nothing off-origin loaded', () => {
    for (const p of pages) {
      const page = html(p);
      expect(page, p).toMatch(/<meta charset="utf-8">/i);
      // the one inline script is the JSON-LD data block, which the browser never executes
      expect(page, `${p} has an inline script`).not.toMatch(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>/i);
      expect(page.match(/<script type="application\/ld\+json">/g), `${p}: one data block`).toHaveLength(1);
      // every loaded asset is relative; the canonical link names the production address on purpose and loads nothing
      for (const m of page.matchAll(/<(?:script|link(?! rel="canonical")|img)[^>]*(?:src|href)="([^"]+)"/g)) expect(m[1], p).not.toMatch(/^[a-z]+:|^\/\//i);
    }
  });

  it('every page has a meta description, one canonical production address, and the footer: author, viewer, legal page', () => {
    const entries = JSON.parse(readFileSync(path.join(root, 'docs/manual/manifest.json'), 'utf8')) as {
      chapters: { file: string; pageTitle: string; description: string }[];
    };
    for (const p of pages) {
      const page = html(p);
      const canon = [...page.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map((m) => m[1]);
      expect(canon, p).toEqual([p === 'index.html' ? 'https://cbctscope.com/manual/' : `https://cbctscope.com/manual/${p}`]);
      expect(page, p).toMatch(/<meta name="description" content="[^"]{50,}">/);
      const foot = /<footer class="foot">[\s\S]*?<\/footer>/.exec(page)?.[0] ?? '';
      expect(foot, `${p}: the author line links his name to his site`).toContain('By <a href="https://rezamotaghi.com" target="_blank" rel="noopener noreferrer">Dr. Reza Motaghi</a>, oral and maxillofacial radiologist');
      expect(foot, `${p}: a link to the About page`).toContain('<a href="../about">About CBCTScope</a>');
      expect(foot, `${p}: a link back to the viewer`).toContain('href="../"');
      expect(foot, `${p}: a link to the legal page`).toContain('href="../legal"');
    }
    // the manifest's title and description become the page's, the headings stay the markdown's
    for (const c of entries.chapters) {
      const page = html(pageName(c.file));
      expect(page).toContain(`<title>${c.pageTitle.replace(/&/g, '&amp;')} · CBCTScope manual</title>`);
      expect(page).toContain(`<meta name="description" content="${c.description.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`);
    }
    expect(html('mpr.html')).toContain('<h1 id="mpr">MPR</h1>');
  });

  it('every page carries the share card and one JSON-LD block: the article of the manual about the viewer, by its author, and its breadcrumb trail, with no date', () => {
    const entries = JSON.parse(readFileSync(path.join(root, 'docs/manual/manifest.json'), 'utf8')) as {
      title: string;
      description: string;
      chapters: { file: string; title: string; pageTitle: string; description: string }[];
    };
    const author = { '@id': 'https://rezamotaghi.com/#person', '@type': 'Person', name: 'Reza Motaghi' };
    const about = { '@id': 'https://cbctscope.com/#software' };
    const index = 'https://cbctscope.com/manual/';
    const meta = (page: string, attr: string, key: string) =>
      [...page.matchAll(new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`, 'g'))].map((m) => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    const pagesOf: [string, string, string, string | null][] = [
      ['index.html', entries.title, entries.description, null],
      ...entries.chapters.map((c): [string, string, string, string] => [pageName(c.file), `${c.pageTitle} · CBCTScope manual`, c.description, c.title]),
    ];
    for (const [p, title, description, crumb] of pagesOf) {
      const page = html(p);
      const url = p === 'index.html' ? index : `https://cbctscope.com/manual/${p}`;
      const head = page.slice(0, page.indexOf('</head>'));
      expect(meta(head, 'property', 'og:type'), p).toEqual(['article']);
      expect(meta(head, 'property', 'og:site_name'), p).toEqual(['CBCTScope']);
      expect(meta(head, 'property', 'og:title'), p).toEqual([title]);
      expect(meta(head, 'property', 'og:description'), p).toEqual([description]);
      expect(meta(head, 'property', 'og:url'), p).toEqual([url]);
      expect(meta(head, 'property', 'og:image'), p).toEqual(['https://cbctscope.com/og-card.png']);
      expect([meta(head, 'property', 'og:image:width'), meta(head, 'property', 'og:image:height')], p).toEqual([['1200'], ['630']]);
      expect(meta(head, 'name', 'twitter:card'), p).toEqual(['summary_large_image']);
      expect(meta(head, 'name', 'twitter:title'), p).toEqual([title]);
      expect(meta(head, 'name', 'twitter:description'), p).toEqual([description]);
      expect(meta(head, 'name', 'twitter:image'), p).toEqual(['https://cbctscope.com/og-card.png']);
      const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head)?.[1] ?? '';
      expect(block, p).not.toMatch(/"date\w*"\s*:/i);
      const [item, trail] = (JSON.parse(block) as { '@graph': Record<string, unknown>[] })['@graph'];
      const crumbs = [
        { '@type': 'ListItem', position: 1, name: 'CBCTScope', item: 'https://cbctscope.com' },
        { '@type': 'ListItem', position: 2, name: 'User manual', item: index },
      ];
      if (crumb === null) {
        expect(item, p).toEqual({ '@type': 'CollectionPage', '@id': index, name: entries.title, description, url: index, inLanguage: 'en', author, about });
        expect(trail).toEqual({ '@type': 'BreadcrumbList', itemListElement: crumbs });
      } else {
        expect(item, p).toEqual({
          '@type': 'TechArticle',
          headline: title.replace(/ · CBCTScope manual$/, ''),
          description,
          url,
          inLanguage: 'en',
          author,
          isPartOf: { '@type': 'CollectionPage', '@id': index, name: entries.title, url: index },
          about,
        });
        expect(trail).toEqual({ '@type': 'BreadcrumbList', itemListElement: [...crumbs, { '@type': 'ListItem', position: 3, name: crumb, item: url }] });
      }
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
