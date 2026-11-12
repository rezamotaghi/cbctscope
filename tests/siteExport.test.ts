// The web build's export as a crawler and a reader without scripts meet it (docs/web-build.md,
// section 14): the served home page carries its text and links before any script runs, the
// About and legal pages exist with their parts, sitemap.xml lists every page and nothing else,
// and every page names one canonical production address. The files are parsed, no browser.
// Runs when out/ exists (after `npm run build:web`), like tests/webBudget.test.ts.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME_LEAD, HOME_LINKS, HOME_NOSCRIPT, HOME_PRIVACY_WEB, HOME_RESEARCH, LEGAL_PURPOSE } from '../components/sitePages';
import { NOT_PAGES, sitePages, sitePath } from '../scripts/sitemap.mjs';

const out = path.join(process.cwd(), 'out');
const built = existsSync(path.join(out, 'index.html'));
const read = (rel: string) => readFileSync(path.join(out, rel), 'utf8');

/** entities a static page writes for text: back to the characters */
const decode = (s: string) =>
  s
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** a page's visible text before any script runs: scripts and styles removed, tags dropped, entities decoded */
function servedText(html: string): string {
  const body = html.slice(html.indexOf('<body'));
  return decode(
    body
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** the hrefs of the page's links, outside scripts */
const hrefs = (html: string) => [...html.replace(/<script[\s\S]*?<\/script>/gi, '').matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => decode(m[1]));

describe.skipIf(!built)('the exported site', () => {
  it('the served home page carries the author, the three sentences and every link before any script runs', () => {
    const html = read('index.html');
    const text = servedText(html);
    for (const s of ['CBCTScope', 'Reza Motaghi', HOME_LEAD, HOME_PRIVACY_WEB, HOME_RESEARCH, HOME_NOSCRIPT]) expect(text).toContain(s);
    expect(html).toMatch(/<h1>CBCTScope<\/h1>/);
    const links = hrefs(html);
    for (const l of HOME_LINKS) expect(links, `the link to ${l.label}`).toContain(l.href);
    // the manual, the eight guides, About, legal, the source and the author's page
    expect(HOME_LINKS.filter((l) => l.href.startsWith('manual/'))).toHaveLength(9);
    for (const l of HOME_LINKS) if (!l.external) expect(existsSync(path.join(out, l.href.endsWith('.html') ? l.href : `${l.href}.html`)), l.href).toBe(true);
    expect(text).not.toMatch(/—/);
  });

  it('the home page and the About page carry the structured data, and the policy gives the data block no hash', () => {
    for (const file of ['index.html', 'about.html']) {
      const html = read(file);
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(blocks, file).toHaveLength(1);
      const data = JSON.parse(blocks[0][1]) as { '@type': string; identifier: { value: string }; author: { name: string } };
      expect(data['@type']).toBe('WebApplication');
      expect(data.author.name).toBe('Reza Motaghi');
      expect(data.identifier.value).toMatch(/^10\.5281\/zenodo\.\d+$/);
      // one script-src hash per executed inline script, none for the data block
      const csp = decode(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '');
      const executed = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => m[2] && !/application\/ld\+json/.test(m[1]));
      const hashes = csp.match(/'sha256-[^']+'/g) ?? [];
      expect(new Set(hashes).size, file).toBe(new Set(executed.map((m) => m[2])).size);
      expect(csp).not.toContain("'unsafe-inline' 'self'"); // script-src unchanged in shape
      expect(/script-src ([^;]*)/.exec(csp)?.[1]).not.toContain("'unsafe-inline'");
    }
  });

  it('/about holds what it is, the author, the citation, the licence, the privacy summary and the links', () => {
    const html = read('about.html');
    const text = servedText(html);
    for (const s of ['About CBCTScope', 'Who made it', 'board-certified oral and maxillofacial radiologist', 'How to cite it', 'BibTeX', 'Licence', 'AGPL-3.0-or-later', 'Privacy', 'never uploaded']) {
      expect(text, s).toContain(s);
    }
    const links = hrefs(html);
    for (const h of ['https://rezamotaghi.com', 'legal', 'manual/index.html', 'https://github.com/rezamotaghi/cbctscope', 'https://github.com/rezamotaghi/cbctscope/blob/main/LICENSE']) {
      expect(links, h).toContain(h);
    }
    expect(text).not.toMatch(/[—]/);
  });

  it('/legal holds the legal notice, privacy, research use, licence and warranty; Vienna, Austria and no street address', () => {
    const html = read('legal.html');
    const text = servedText(html);
    for (const s of [
      'Legal notice',
      'Impressum and disclosure under section 25 of the Mediengesetz',
      'Reza Motaghi',
      'Vienna, Austria',
      LEGAL_PURPOSE,
      'contact@cbctscope.com',
      'Privacy',
      'no cookies',
      'GitHub Pages',
      'IP address',
      'model provider you chose',
      'GDPR',
      'Datenschutzbehörde',
      'Research software',
      'not a medical device',
      'Licence and warranty',
      'AGPL-3.0-or-later',
      'without warranty',
    ]) {
      expect(text, s).toContain(s);
    }
    expect(hrefs(html)).toEqual(expect.arrayContaining(['mailto:contact@cbctscope.com', 'https://www.dsb.gv.at', 'https://github.com/rezamotaghi/cbctscope/blob/main/LICENSE']));
    expect(hrefs(html).some((h) => h.startsWith('https://docs.github.com/'))).toBe(true);
    // no street address: no street word followed by a number, no postcode before Vienna or Wien
    expect(text).not.toMatch(/\b\w*(?:straße|strasse|gasse|platz|weg|street|road|avenue)\s*\d/i);
    expect(text).not.toMatch(/\b\d{4}\s+(?:Vienna|Wien)\b/);
    expect(text).not.toMatch(/[—]/);
  });

  it('sitemap.xml lists every exported page and nothing else; robots.txt names it', () => {
    const listed = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
    const pages = sitePages(out).map((p) => p.url).sort();
    expect(listed).toEqual(pages);
    expect(listed).toContain('https://cbctscope.com');
    expect(listed).toContain('https://cbctscope.com/about');
    expect(listed).toContain('https://cbctscope.com/legal');
    expect(listed).toContain('https://cbctscope.com/manual/');
    expect(listed).toContain('https://cbctscope.com/manual/mpr.html');
    const manualPages = (JSON.parse(readFileSync(path.join(process.cwd(), 'docs/manual/manifest.json'), 'utf8')) as { chapters: unknown[] }).chapters.length;
    expect(listed).toHaveLength(manualPages + 4);
    for (const not of NOT_PAGES) expect(listed.some((u) => u.endsWith(`/${not}`) || u.endsWith(`/${not.replace(/\.html$/, '')}`))).toBe(false);
    expect(sitePath('about.html')).toBe('/about');
    expect(sitePath('manual/index.html')).toBe('/manual/');
    expect(read('robots.txt')).toBe('User-agent: *\nAllow: /\n\nSitemap: https://cbctscope.com/sitemap.xml\n');
  });

  it('every page names exactly one canonical address, its own production one', () => {
    for (const { file, url } of sitePages(out)) {
      const canon = [...read(file).matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
      expect(canon, file).toEqual([url]);
    }
    expect(read('404.html')).not.toContain('rel="canonical"');
  });
});
