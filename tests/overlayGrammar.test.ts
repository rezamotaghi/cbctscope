// The image panes' overlay grammar (components/cbct/overlayGrammar.ts) and the pane-corner
// buttons (components/cbct/paneButtons.ts): the readouts, the scale bar, the box test the
// end-to-end suite repeats on screen, the plane colours' contrast, and every corner button
// listed with its name in the manual.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLANE_COLOR, boxesOverlap, clampLabel, overlappingPairs, scaleBar, wlText } from '../components/cbct/overlayGrammar';
import { PANE_BUTTONS } from '../components/cbct/paneButtons';

const root = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

/** WCAG relative luminance of a #rrggbb colour */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('the pane overlay grammar', () => {
  it('reads the window as W then L, whole numbers', () => {
    expect(wlText({ center: 1000, width: 4000 })).toBe('W 4000 L 1000');
    expect(wlText({ center: 149.6, width: 900.2 })).toBe('W 900 L 150');
  });
  it('picks the longest round scale length that fits a quarter of the pane', () => {
    // 0.2 mm per px on a 400 px pane: a quarter is 100 px = 20 mm
    expect(scaleBar(0.2, 400)).toEqual({ mm: 20, px: 100, label: '2 cm' });
    expect(scaleBar(0.05, 400)).toEqual({ mm: 5, px: 100, label: '5 mm' });
    expect(scaleBar(0.3, 400)?.mm).toBe(20);
    expect(scaleBar(0, 400)).toBeNull();
    expect(scaleBar(0.2, 0)).toBeNull();
    expect(scaleBar(50, 100)).toBeNull();
  });
  it('counts two boxes as overlapping only when they share area', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10 };
    expect(boxesOverlap(a, { left: 5, top: 5, right: 15, bottom: 15 })).toBe(true);
    expect(boxesOverlap(a, { left: 10, top: 0, right: 20, bottom: 10 })).toBe(false);
    expect(boxesOverlap(a, { left: 0, top: 11, right: 10, bottom: 20 })).toBe(false);
    expect(overlappingPairs([a, { left: 9, top: 9, right: 12, bottom: 12 }, { left: 30, top: 30, right: 40, bottom: 40 }])).toEqual([[0, 1]]);
  });
  it('keeps a measurement label inside its canvas', () => {
    expect(clampLabel(95, 50, 30, 12, 100, 100, 2)).toEqual({ x: 68, y: 50 });
    expect(clampLabel(-5, -5, 30, 12, 100, 100, 2)).toEqual({ x: 2, y: 2 });
    expect(clampLabel(10, 95, 30, 12, 100, 100, 2)).toEqual({ x: 10, y: 86 });
  });
  it('the plane colours meet 4.5:1 on the dark grounds', () => {
    for (const c of Object.values(PLANE_COLOR)) {
      expect(contrast(c, '#0c0e12')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c, '#000000')).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the pane-corner buttons', () => {
  it('each has an icon and a name, and the names are unique', () => {
    const names = PANE_BUTTONS.map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
    for (const b of PANE_BUTTONS) {
      expect(b.icon).toBeTruthy();
      expect(b.what.length).toBeGreaterThan(10);
    }
  });
  it('each is listed by name in the interface chapter of the manual', () => {
    const ch3 = read('docs/manual/03-interface.md');
    for (const b of PANE_BUTTONS) expect(ch3, `manual 3.6 lists ${b.name}`).toContain(`**${b.name}**`);
  });
  it('the panes draw no arrow or rotation characters as button faces', () => {
    for (const f of ['CbctViewport', 'CbctGrid']) {
      const src = read(`components/cbct/${f}.tsx`);
      expect(src, f).not.toMatch(/>\s*[↺↻⇋⟲⟳↶↷↑↓]\s*</);
    }
  });
});
