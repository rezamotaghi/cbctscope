// Classic scrollbars (a Mac with a mouse attached, every Windows machine) are coloured, not
// hidden: a mid grey handle on a dark track, in the viewer and in the manual's dark pages.
// AGENTS.md hard rule 4 keeps the handle visible, so this reads the two colours from each
// stylesheet and holds them to at least 3:1, and keeps the system's own width.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

/** the custom properties of the first `:root {` block, as written */
function rootTokens(css: string): Map<string, string> {
  const start = css.indexOf(':root {');
  expect(start, 'no :root block').toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('\n}', start)).replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+|scrollbar-color)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());
  return tokens;
}

/** a token's value with var() references followed to a hex colour */
function resolve(tokens: Map<string, string>, value: string): string {
  for (let i = 0; i < 10; i++) {
    const ref = /^var\((--[\w-]+)\)$/.exec(value);
    if (!ref) break;
    value = tokens.get(ref[1]) ?? '';
  }
  expect(value, `"${value}" is not a #rrggbb colour`).toMatch(/^#[0-9a-f]{6}$/i);
  return value;
}

/** WCAG relative luminance and contrast ratio */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('classic scrollbars', () => {
  it('computes contrast the WCAG way', () => {
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });

  for (const file of ['app/globals.css', 'scripts/manual/manual.css']) {
    it(`${file}: the handle stands out from the dark track by at least 3:1, at the system width`, () => {
      const css = read(file);
      const tokens = rootTokens(css);
      expect(tokens.get('scrollbar-color'), `${file} must colour the scrollbar on :root`).toBe('var(--scroll-thumb) var(--scroll-track)');
      const thumb = resolve(tokens, tokens.get('--scroll-thumb') ?? '');
      const track = resolve(tokens, tokens.get('--scroll-track') ?? '');
      expect(luminance(track), 'the track is dark').toBeLessThan(0.05);
      expect(contrast(thumb, track), `${thumb} on ${track}`).toBeGreaterThanOrEqual(3);
      // never thinner than the system draws it, never hidden
      expect(css).not.toMatch(/scrollbar-width\s*:\s*(thin|none)/);
      expect(css).not.toMatch(/::-webkit-scrollbar\s*\{[^}]*(width|display)/);
    });
  }
});
