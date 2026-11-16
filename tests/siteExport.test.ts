// The web build's export as a crawler and a reader without scripts meet it (docs/web-build.md,
// section 14): the served home page carries its text and links before any script runs, the
// About and legal pages exist with their parts, sitemap.xml lists every page and nothing else,
// and every page names one canonical production address. The files are parsed, no browser.
// Runs when out/ exists (after `npm run build:web`), like tests/webBudget.test.ts.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME_LEAD, HOME_LINKS, HOME_NOSCRIPT, HOME_PRIVACY_WEB, HOME_RESEARCH, LEGAL_PURPOSE, PHONE_ACTIONS, PHONE_COMPUTER, PHONE_LINKS, PHONE_STILL } from '../components/sitePages';
import { NOINDEX_PAGES, NOT_PAGES, sitemapPages, sitePages, sitePath } from '../scripts/sitemap.mjs';
import { vercelConfig } from '../scripts/vercel-output.mjs';
import { LIVE_FILES, exportFiles, forbiddenMarkers, offOriginAssets, pageAssets, typeFileFor, versionProblem } from '../scripts/site-check.mjs';
import { SITE_URL } from '../components/siteAddress.mjs';
import pkg from '../package.json';

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

/** a fragment's text with its tags dropped and nothing put in their place, so a sentence broken by a link reads whole */
const flatText = (html: string) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** the anchors whose text contains a name, as [href, target, rel] */
const anchorsNamed = (html: string, name: string) =>
  [...html.replace(/<script[\s\S]*?<\/script>/gi, '').matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter((m) => decode(m[2].replace(/<[^>]+>/g, '')).includes(name))
    .map((m) => ({ href: decode(/href="([^"]*)"/.exec(m[1])?.[1] ?? ''), target: /target="([^"]*)"/.exec(m[1])?.[1], rel: /rel="([^"]*)"/.exec(m[1])?.[1], text: decode(m[2].replace(/<[^>]+>/g, '')) }));

/** the author's name is a link to his site, opened as the other outbound links are; the text is the name alone */
function expectAuthorLink(html: string, name: string) {
  const a = anchorsNamed(html, 'Reza Motaghi').filter((x) => x.href === 'https://rezamotaghi.com');
  expect(a.length, `an anchor to https://rezamotaghi.com reading ${name}`).toBeGreaterThan(0);
  expect(a[0].text).toBe(name);
  expect(a[0].target).toBe('_blank');
  expect(a[0].rel).toBe('noopener noreferrer');
}

/** the hrefs of the page's links, outside scripts */
const hrefs = (html: string) => [...html.replace(/<script[\s\S]*?<\/script>/gi, '').matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => decode(m[1]));

describe.skipIf(!built)('the exported site', () => {
  it('the served home page carries the author, the three sentences and every link before any script runs', () => {
    const html = read('index.html');
    const text = servedText(html);
    for (const s of ['CBCTScope', 'Reza Motaghi', HOME_PRIVACY_WEB, HOME_RESEARCH, HOME_NOSCRIPT]) expect(text).toContain(s);
    expect(flatText(html.slice(html.indexOf('<body')).replace(/<script[\s\S]*?<\/script>/gi, ''))).toContain(HOME_LEAD);
    expect(html).toMatch(/<h1>CBCTScope<\/h1>/);
    expectAuthorLink(html, 'Reza Motaghi');
    const links = hrefs(html);
    for (const l of HOME_LINKS) expect(links, `the link to ${l.label}`).toContain(l.href);
    // the manual, the eight guides, About, legal, the source and the author's page
    expect(HOME_LINKS.filter((l) => l.href.startsWith('manual/'))).toHaveLength(9);
    for (const l of HOME_LINKS) if (!l.external) expect(existsSync(path.join(out, l.href.endsWith('.html') ? l.href : `${l.href}.html`)), l.href).toBe(true);
    expect(text).not.toMatch(/—/);
  });

  it('the served home page is one document for every device: one h1, one main, the lead once, and the phone part', () => {
    const html = read('index.html');
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    expect(body.match(/<h1[\s>]/g), 'one h1').toHaveLength(1);
    expect(body.match(/<main[\s>]/g), 'one main').toHaveLength(1);
    // the lead, rendered once, is the first sentence after the heading on every device
    expect(flatText(body).split(HOME_LEAD)).toHaveLength(2);
    expect(servedText(html)).toContain(PHONE_COMPUTER);
    expect(html).toContain('data-testid="phone-landing"');
    expect(existsSync(path.join(out, PHONE_STILL.src)), PHONE_STILL.src).toBe(true);
    const links = hrefs(html);
    for (const a of [...PHONE_ACTIONS, ...PHONE_LINKS]) expect(links, a.label).toContain(a.href);
  });

  it('favicon.ico is the committed file, an icon holding 16, 32 and 48 px, and no page links it', () => {
    const ico = readFileSync(path.join(out, 'favicon.ico'));
    expect(ico.equals(readFileSync(path.join(process.cwd(), 'public', 'favicon.ico')))).toBe(true);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)], 'the ICONDIR header').toEqual([0, 1]);
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => [ico.readUInt8(6 + 16 * i), ico.readUInt8(7 + 16 * i)]);
    expect(sizes).toEqual([[16, 16], [32, 32], [48, 48]]);
    // each entry's payload is a PNG that lies inside the file
    for (let i = 0; i < sizes.length; i++) {
      const [size, offset] = [ico.readUInt32LE(14 + 16 * i), ico.readUInt32LE(18 + 16 * i)];
      expect(offset + size).toBeLessThanOrEqual(ico.length);
      expect(ico.subarray(offset, offset + 8).toString('latin1')).toBe('\x89PNG\r\n\x1a\n');
    }
    // the pages keep linking the SVG and the touch icon; the .ico answers by its address alone
    for (const file of ['index.html', 'about.html', 'legal.html']) {
      expect(read(file), file).toMatch(/<link rel="icon" href="\/icon\.svg[^"]*" type="image\/svg\+xml"/);
      expect(read(file), file).not.toContain('favicon.ico');
    }
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
    expectAuthorLink(html, 'Dr. Reza Motaghi');
    expect(flatText(html)).toContain('develops, evaluates and trains imaging AI. He is the creator of Radigrade, a registered protocol for grading AI-written radiograph reports. ORCID:');
    const radigrade = anchorsNamed(html, 'Radigrade').filter((x) => x.href === 'https://radigrade.com');
    expect(radigrade).toHaveLength(1);
    expect(radigrade[0].text).toBe('Radigrade');
    expect(radigrade[0].target).toBe('_blank');
    expect(radigrade[0].rel).toBe('noopener noreferrer');
    expect(hrefs(html).filter((h) => h.includes('radigrade'))).toEqual(['https://radigrade.com']);
    expect(text).not.toContain('his own site');
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
      'hosted by Vercel Inc.',
      'IP address',
      'EU-US Data Privacy Framework',
      'standard contractual clauses',
      'installers are downloaded from GitHub',
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
    expectAuthorLink(html, 'Reza Motaghi');
    expect(hrefs(html)).toEqual(expect.arrayContaining(['mailto:contact@cbctscope.com', 'https://www.dsb.gv.at', 'https://github.com/rezamotaghi/cbctscope/blob/main/LICENSE']));
    expect(hrefs(html).some((h) => h.startsWith('https://docs.github.com/'))).toBe(true);
    expect(hrefs(html)).toContain('https://vercel.com/legal/privacy-policy');
    expect(text).not.toContain('GitHub Pages');
    // no street address: no street word followed by a number, no postcode before Vienna or Wien
    expect(text).not.toMatch(/\b\w*(?:straße|strasse|gasse|platz|weg|street|road|avenue)\s*\d/i);
    expect(text).not.toMatch(/\b\d{4}\s+(?:Vienna|Wien)\b/);
    expect(text).not.toMatch(/[—]/);
  });

  it('/update is noindex, says the newest version with the downloads before any script runs, and is served at /update', () => {
    const html = read('update.html');
    const text = servedText(html);
    expect(html).toMatch(/<meta name="robots" content="noindex, ?follow"\/>/);
    expect(text).toContain('Check for updates');
    expect(text).toContain(`The newest version of CBCTScope is ${pkg.version}.`);
    expect(text).toContain('Research use only. Not a medical device.');
    // how to install over the old version: the disk image, the setup file and the portable build
    expect(text).toContain('replacing the old copy');
    expect(text).toContain('run the new setup file');
    expect(text).toContain('replace the old portable file with the new one');
    // no verdict and no note about the address without a version
    expect(text).not.toContain('You have');
    expect(text).not.toContain('after the # sign');
    const links = hrefs(html);
    for (const name of ['CBCTScope-mac-arm64.dmg', 'CBCTScope-mac-x64.dmg', 'CBCTScope-windows-setup.exe']) {
      expect(links).toContain(`https://github.com/rezamotaghi/cbctscope/releases/latest/download/${name}`);
    }
    expect(links).toContain('https://github.com/rezamotaghi/cbctscope/releases/latest');
    expect(vercelConfig(sitePages(out)).overrides['update.html']).toEqual({ path: 'update', contentType: 'text/html; charset=utf-8' });
    expect(text).not.toMatch(/[—]/);
  });

  it('every manual page footer links the author name to his site, then the About page, the viewer and the legal page', () => {
    const pages = sitePages(out).filter((p) => p.file.startsWith('manual/'));
    expect(pages.length).toBeGreaterThan(0);
    for (const { file } of pages) {
      const html = read(file);
      const foot = /<footer class="foot">[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
      expectAuthorLink(foot, 'Dr. Reza Motaghi');
      expect(flatText(foot), file).toContain('By Dr. Reza Motaghi, oral and maxillofacial radiologist');
      const about = anchorsNamed(foot, 'About CBCTScope');
      expect(about.map((a) => a.href), file).toEqual(['../about']);
      expect(hrefs(foot), file).toEqual(expect.arrayContaining(['../', '../legal']));
    }
  });

  it('Radigrade is named on the About page only', () => {
    for (const { file } of sitePages(out)) {
      if (file === 'about.html') continue;
      expect(read(file), file).not.toMatch(/radigrade/i);
    }
  });

  it('sitemap.xml lists every exported page but the noindex ones and nothing else; robots.txt names it', () => {
    const listed = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
    const pages = sitemapPages(out).map((p) => p.url).sort();
    expect(listed).toEqual(pages);
    expect(sitePages(out).filter((p) => NOINDEX_PAGES.has(p.file)).map((p) => p.file)).toEqual(['update.html']);
    expect(listed).not.toContain('https://cbctscope.com/update');
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

  // the live check after a deploy (scripts/site-check.mjs --live) reads these from the public
  // site; here the export proves it would pass on the files this build made
  it('holds what the live check asks for: its fixed files, same-origin assets, no host marker, the version on the update page', () => {
    const moved = vercelConfig(sitePages(out)).overrides;
    const served = new Set(exportFiles(out).map((f) => (moved[f] ? `/${moved[f].path}` : `/${f}`)));
    for (const p of LIVE_FILES) expect(served.has(p) || served.has(`${p}index.html`), p).toBe(true);
    for (const f of exportFiles(out).filter((x) => x.endsWith('.html'))) {
      const html = read(f);
      expect(forbiddenMarkers(html), f).toEqual([]);
      const at = moved[f] ? `/${moved[f].path}` : `/${f}`;
      const assets = pageAssets(html, new URL(at, SITE_URL).toString());
      expect(offOriginAssets(assets, SITE_URL), f).toEqual([]);
      for (const a of assets) expect(exportFiles(out), `${f}: ${a}`).toContain(new URL(a).pathname.slice(1));
    }
    expect(pageAssets(read('index.html'), SITE_URL).length).toBeGreaterThan(0);
    expect(versionProblem(read('update.html'), pkg.version)).toBeNull();
    expect(typeFileFor(LIVE_FILES[LIVE_FILES.length - 1])).toBe('/manual/index.html');
  });
});
