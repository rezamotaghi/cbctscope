// The public site's page-view counter (scripts/site-counter.mjs, docs/web-build.md, section 3):
// exactly the pages sitemap.xml lists are counted, and the site's build writes the one tag
// right after the CSP meta tag. The update page, the agent frame and the 404 page are never
// counted.
import { describe, expect, it } from 'vitest';
import { COUNTER_ROUTES, COUNTER_SCRIPT, COUNTER_TAG, addCounter, counterProblem, isCounted } from '../scripts/site-counter.mjs';
import { NOINDEX_PAGES, NOT_PAGES } from '../scripts/sitemap.mjs';

const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src &#x27;self&#x27;"/>';
const page = `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>${CSP}<title>x</title></head><body></body></html>`;

describe('the page-view counter', () => {
  it('is the documented plain-HTML tag, same-origin, with no inline stub', () => {
    expect(COUNTER_TAG).toBe('<script defer src="/_vercel/insights/script.js"></script>');
    expect(COUNTER_SCRIPT).toBe('/_vercel/insights/script.js');
    expect(COUNTER_SCRIPT.startsWith(COUNTER_ROUTES)).toBe(true);
  });

  it('counts exactly the pages the sitemap lists', () => {
    for (const rel of ['index.html', 'about.html', 'legal.html', 'manual/index.html', 'manual/mpr.html']) expect(isCounted(rel), rel).toBe(true);
    for (const rel of ['update.html', 'agent-frame.html', '404.html', '_not-found.html', '_next/static/x.html', 'sitemap.xml', 'robots.txt', 'og-card.png']) {
      expect(isCounted(rel), rel).toBe(false);
    }
    for (const rel of [...NOT_PAGES, ...NOINDEX_PAGES]) expect(isCounted(rel), rel).toBe(false);
  });

  it('writes the tag once, right after the CSP meta tag', () => {
    const html = addCounter(page);
    expect(html.split(COUNTER_TAG)).toHaveLength(2);
    expect(html.split(COUNTER_ROUTES)).toHaveLength(2);
    expect(html).toContain(`<meta charSet="utf-8"/>${CSP}${COUNTER_TAG}<title>`);
    expect(counterProblem(html, true)).toBeNull();
  });

  it('refuses a page that already carries the tag or any reference to the routes, and one without a CSP meta tag', () => {
    expect(() => addCounter(addCounter(page))).toThrow(/already refers/);
    expect(() => addCounter(page.replace('</head>', '<link rel="preload" href="/_vercel/insights/x.js"/></head>'))).toThrow(/already refers/);
    expect(() => addCounter(page.replace(CSP, ''))).toThrow(/no CSP meta tag/);
  });

  it('holds counted pages to one tag and every other page to none', () => {
    expect(counterProblem(page, false)).toBeNull();
    expect(counterProblem(page, true)).toMatch(/0 times, expected once/);
    expect(counterProblem(addCounter(page), false)).toMatch(/expected none/);
    expect(counterProblem(page.replace('</head>', `${COUNTER_TAG}${COUNTER_TAG}</head>`), true)).toMatch(/2 times/);
  });
});
