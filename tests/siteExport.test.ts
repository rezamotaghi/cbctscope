// The web build's export as a crawler and a reader without scripts meet it (docs/web-build.md,
// section 14): the served home page carries its text and links before any script runs, the
// About, legal and questions and answers pages exist with their parts, sitemap.xml lists every page and nothing else,
// and every page names one canonical production address. The files are parsed, no browser.
// Runs when out/ exists (after `npm run build:web`), like tests/webBudget.test.ts.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOME_LEAD, HOME_LINKS, HOME_NOSCRIPT, HOME_PRIVACY_WEB, HOME_RESEARCH, LEGAL_PURPOSE, PHONE_ACTIONS, PHONE_COMPUTER, PHONE_LINKS, PHONE_STILL, QA_LEAD, QA_TITLE } from '../components/sitePages';
import { SITE_QUESTIONS } from '../components/siteQuestions';
import { INSTALLER_NAMES, installerUrl } from '../components/downloads';
import { VIEW_MODES } from '../lib/shared/verbs.mjs';
import manualManifest from '../docs/manual/manifest.json';
import { NOINDEX_PAGES, NOT_PAGES, sitemapPages, sitePages, sitePath } from '../scripts/sitemap.mjs';
import { vercelConfig } from '../scripts/vercel-output.mjs';
import { LIVE_FILES, exportFiles, forbiddenMarkers, offOriginAssets, pageAssets, typeFileFor, versionProblem } from '../scripts/site-check.mjs';
import { SITE_URL } from '../components/siteAddress.mjs';
import { COUNTER_SCRIPT, COUNTER_TAG, counterProblem, isCounted, pagesWithCounter } from '../scripts/site-counter.mjs';
import pkg from '../package.json';
import { LLMS_SITE_PAGES } from '../scripts/llms-txt.mjs';
import { AUTHOR_PROJECT_URL, CONCEPT_DOI, DOI_RESOLVER, REPO_URL } from '../components/siteAddress.mjs';
import { SITE_CLAIM } from '../components/siteWords.mjs';

const out = path.join(process.cwd(), 'out');
const built = existsSync(path.join(out, 'index.html'));
/** which flavour of out/ this run expects: the site's build when CBCTSCOPE_EXPORT=site, else the plain web build */
const SITE_EXPORT = process.env.CBCTSCOPE_EXPORT === 'site';
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
    // the manual, the eight guides, the questions and answers, About, legal, the source and the author's page
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
    for (const file of ['index.html', 'about.html', 'legal.html', 'online-cbct-viewer.html']) {
      expect(read(file), file).toMatch(/<link rel="icon" href="\/icon\.svg[^"]*" type="image\/svg\+xml"/);
      expect(read(file), file).not.toContain('favicon.ico');
    }
  });

  it('the home page and the About page carry the structured data, and the policy gives the data block no hash', () => {
    for (const file of ['index.html', 'about.html']) {
      const html = read(file);
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
      // the home page: the viewer, then the site; the About page: the viewer
      expect(blocks.map((b) => b['@type']), file).toEqual(file === 'index.html' ? ['WebApplication', 'WebSite'] : ['WebApplication']);
      const data = blocks[0] as { identifier: { value: string }; featureList: string[]; [field: string]: unknown };
      expect(data.identifier.value).toMatch(/^10\.5281\/zenodo\.\d+$/);
      expect(data['@id']).toBe('https://cbctscope.com/#software');
      expect(data.isAccessibleForFree).toBe(true);
      expect(data.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
      expect(data.license).toBe('https://github.com/rezamotaghi/cbctscope/blob/main/LICENSE');
      expect(data.softwareVersion).toBe(pkg.version);
      expect(data.downloadUrl).toEqual(Object.values(INSTALLER_NAMES).map(installerUrl));
      expect(data.softwareHelp).toEqual({ '@type': 'CollectionPage', '@id': 'https://cbctscope.com/manual/', name: manualManifest.title, url: 'https://cbctscope.com/manual/' });
      // the screenshot is a still the site serves
      expect(data.screenshot).toBe(`https://cbctscope.com/${PHONE_STILL.src}`);
      expect(existsSync(path.join(out, PHONE_STILL.src))).toBe(true);
      // the features are the eight reading modes, named as the manual's chapters 8.1 to 8.8 name them, one per view mode
      expect(data.featureList).toEqual(manualManifest.chapters.filter((c) => c.file.startsWith('docs/reading-modes/')).map((c) => c.title.split(' · ')[1]));
      expect(data.featureList.map((f) => f.toLowerCase())).toEqual(VIEW_MODES);
      expect(data.sameAs).toEqual(['https://rezamotaghi.com/cbctscope', 'https://github.com/rezamotaghi/cbctscope', `https://doi.org/${data.identifier.value}`]);
      expect(data.author).toEqual({
        '@type': 'Person',
        '@id': 'https://rezamotaghi.com/#person',
        name: 'Reza Motaghi',
        honorificPrefix: 'Dr.',
        alternateName: 'Dr. Reza Motaghi',
        jobTitle: 'Board-certified oral and maxillofacial radiologist',
        url: 'https://rezamotaghi.com',
        sameAs: ['https://orcid.org/0009-0005-3194-1879', 'https://github.com/rezamotaghi'],
      });
      if (file === 'index.html') expect(blocks[1]).toEqual({ '@context': 'https://schema.org', '@type': 'WebSite', '@id': 'https://cbctscope.com/#website', name: 'CBCTScope', url: 'https://cbctscope.com' });
      // no ratings, reviews or medical types in any block
      for (const b of blocks) expect(JSON.stringify(b), file).not.toMatch(/aggregateRating|"review|Medical/);
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
    for (const h of ['https://rezamotaghi.com', 'legal', 'manual/index.html', 'online-cbct-viewer', 'https://github.com/rezamotaghi/cbctscope', 'https://github.com/rezamotaghi/cbctscope/blob/main/LICENSE']) {
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

  it('/online-cbct-viewer holds its h1, the lead, every question with its answer and manual link, the matching FAQPage and its canonical', () => {
    const html = read('online-cbct-viewer.html');
    const body = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    const text = servedText(html);
    expect([...body.matchAll(/<h1>([\s\S]*?)<\/h1>/g)].map((m) => flatText(m[1]))).toEqual([QA_TITLE]);
    expect(decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '')).toBe(QA_TITLE);
    expect(text).toContain(QA_LEAD);
    expect([...body.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => flatText(m[1]))).toEqual(SITE_QUESTIONS.map((q) => q.question));
    expect(SITE_QUESTIONS.length).toBeGreaterThanOrEqual(8);
    expect(SITE_QUESTIONS.length).toBeLessThanOrEqual(12);
    const links = hrefs(html);
    for (const q of SITE_QUESTIONS) {
      expect(text, q.question).toContain(q.answer);
      expect(q.links.length, q.question).toBeGreaterThan(0);
      for (const l of q.links) {
        expect(anchorsNamed(html, l.label).map((a) => a.href), q.question).toContain(l.href);
        // the link lands on a manual page of the export, at a heading it holds
        const [file, hash] = l.href.split('#');
        expect(file.startsWith('manual/') && existsSync(path.join(out, file)), l.href).toBe(true);
        if (hash) expect(read(file), l.href).toContain(`id="${hash}"`);
        expect(links).toContain(l.href);
      }
    }
    // one mention of the agent, in the privacy answer, with its rule
    expect(SITE_QUESTIONS.filter((q) => /\bagent\b/i.test(q.answer)).map((q) => q.question)).toEqual(['Is my scan uploaded?']);
    expect(SITE_QUESTIONS.find((q) => q.question === 'Is my scan uploaded?')?.answer).toContain('moves the camera and never produces findings (the human reads)');
    // the structured data is the same array: one FAQPage, each question with its answer
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(blocks).toHaveLength(1);
    const data = JSON.parse(blocks[0][1]) as { '@type': string; mainEntity: { '@type': string; name: string; acceptedAnswer: { text: string } }[] };
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity).toHaveLength(SITE_QUESTIONS.length);
    expect(data.mainEntity.map((e) => [e['@type'], e.name, e.acceptedAnswer.text])).toEqual(SITE_QUESTIONS.map((q) => ['Question', q.question, q.answer]));
    expect([...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1])).toEqual(['https://cbctscope.com/online-cbct-viewer']);
    expect(vercelConfig(sitePages(out)).overrides['online-cbct-viewer.html']).toEqual({ path: 'online-cbct-viewer', contentType: 'text/html; charset=utf-8' });
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
    expect(listed).toContain('https://cbctscope.com/online-cbct-viewer');
    expect(listed).toContain('https://cbctscope.com/manual/');
    expect(listed).toContain('https://cbctscope.com/manual/mpr.html');
    const manualPages = (JSON.parse(readFileSync(path.join(process.cwd(), 'docs/manual/manifest.json'), 'utf8')) as { chapters: unknown[] }).chapters.length;
    expect(listed).toHaveLength(manualPages + 5);
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

  // out/ holds one of two flavours, and the run says which it expects: the plain web build (the
  // desktop app's, the local app's, the end-to-end suite's), where no page refers to the counter,
  // or, with CBCTSCOPE_EXPORT=site, the site's build (--site), where exactly the sitemap's pages
  // carry the tag once, right after the CSP meta tag. A site build left in out/ fails the plain
  // run: `npm run build:web` puts the plain one back.
  it(`carries the page-view counter in ${SITE_EXPORT ? "exactly the sitemap's pages, once each" : 'no page'}`, () => {
    const files = exportFiles(out).filter((f) => f.endsWith('.html'));
    const counted = sitemapPages(out).map((p) => p.file).sort();
    expect(counted.length).toBeGreaterThan(0);
    expect(files.filter((f) => isCounted(f)).sort()).toEqual(counted);
    expect(pagesWithCounter(out), SITE_EXPORT ? 'the site build' : 'the plain build: out/ holds the site build, run npm run build:web').toEqual(SITE_EXPORT ? counted : []);
    for (const f of files) {
      const html = read(f);
      expect(counterProblem(html, SITE_EXPORT && counted.includes(f)), f).toBeNull();
      if (SITE_EXPORT && counted.includes(f)) {
        expect(html.slice(0, html.indexOf(COUNTER_TAG)), f).toMatch(/<meta http-equiv="Content-Security-Policy" content="[^"]*"\/>$/);
      }
    }
  });

  it('llms.txt: the name, the claim, then links to the sitemap\'s pages and the named project addresses only; not a page', () => {
    const text = read('llms.txt');
    const lines = text.split('\n');
    expect(lines[0]).toBe('# CBCTScope');
    expect(lines[2]).toBe(`> ${SITE_CLAIM}`);
    // the paragraph's first sentence says where the viewer runs, with no AI word
    expect(lines[4].split('. ')[0]).not.toMatch(/\b(AI|agents?|models?|LLMs?|MCP)\b/);
    expect(lines.filter((l) => l.startsWith('## '))).toEqual(['## The site', '## User manual', '## Source and citation']);
    const links = [...text.matchAll(/^- \[([^\]]+)\]\(([^)]+)\): (.+)$/gm)].map((m) => ({ text: m[1], url: m[2], note: m[3] }));
    const sitemap = new Set(sitemapPages(out).map((p) => p.url));
    const external = [REPO_URL, `${DOI_RESOLVER}${CONCEPT_DOI}`, AUTHOR_PROJECT_URL];
    for (const l of links) expect(sitemap.has(l.url) || external.includes(l.url), l.url).toBe(true);
    // every page of the sitemap is listed, the external addresses once each
    expect(new Set(links.map((l) => l.url).filter((u) => sitemap.has(u)))).toEqual(sitemap);
    expect(links.filter((l) => external.includes(l.url)).map((l) => l.url)).toEqual(external);
    // the site's pages carry their own title and description
    for (const [file, name] of LLMS_SITE_PAGES) {
      const html = read(file);
      const title = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '');
      const description = decode(/<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '');
      expect(links.find((l) => l.text === name)?.note, file).toBe(`${title}. ${description}`);
    }
    expect(text).not.toMatch(/\u2014/);
    expect(sitemapPages(out).map((p) => p.file)).not.toContain('llms.txt');
    expect(isCounted('llms.txt')).toBe(false);
    expect(text).not.toContain(COUNTER_TAG);
  });

  it('every manual page carries one JSON-LD data block, and its policy gives the block no hash', () => {
    for (const { file } of sitePages(out).filter((p) => p.file.startsWith('manual/'))) {
      const html = read(file);
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
      expect(blocks, file).toHaveLength(1);
      const graph = (JSON.parse(blocks[0][1]) as { '@graph': { '@type': string }[] })['@graph'];
      expect(graph.map((g) => g['@type']), file).toEqual([file === 'manual/index.html' ? 'CollectionPage' : 'TechArticle', 'BreadcrumbList']);
      const csp = decode(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '');
      expect(csp, file).toContain('script-src');
      expect(csp.match(/'sha256-[^']+'/g) ?? [], file).toEqual([]);
    }
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
      // the counter's script is served by Vercel once Web Analytics is enabled, never from the export
      for (const a of assets) if (new URL(a).pathname !== COUNTER_SCRIPT) expect(exportFiles(out), `${f}: ${a}`).toContain(new URL(a).pathname.slice(1));
    }
    expect(pageAssets(read('index.html'), SITE_URL).length).toBeGreaterThan(0);
    expect(versionProblem(read('update.html'), pkg.version)).toBeNull();
    expect(typeFileFor(LIVE_FILES[LIVE_FILES.length - 1])).toBe('/manual/index.html');
  });
});
