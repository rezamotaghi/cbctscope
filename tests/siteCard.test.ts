// The page title and the share card say what CBCTScope is: a viewer, who built it, and that the
// scan stays in the browser. The card is rendered from the site constants, never typed twice.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_CLAIM, CARD_PRIVACY } from '@/components/siteCard.mjs';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

describe('the title and the share card', () => {
  it('the page, Open Graph and Twitter titles are one line naming the viewer', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toContain("const TITLE = 'CBCTScope: CBCT and radiograph viewer in your browser';");
    expect(layout).toMatch(/title: TITLE,/);
    expect(layout).toMatch(/openGraph: \{[^}]*title: TITLE,/);
    expect(layout).toMatch(/twitter: \{[^}]*title: TITLE,/);
  });

  it('the card carries the viewer and author line, then the privacy line, and no agent', () => {
    expect(CARD_CLAIM).toBe('Local-first CBCT and 2D radiograph viewer, built by an oral and maxillofacial radiologist.');
    expect(CARD_PRIVACY).toBe('Your scan is read in the browser and never uploaded.');
    for (const line of [CARD_CLAIM, CARD_PRIVACY]) expect(line).not.toMatch(/\b(agent|AI|MCP|model)\b/i);
    const og = read('scripts/og.mjs');
    expect(og).toContain("from '../components/siteCard.mjs'");
    expect(og).toContain('${CARD_CLAIM}');
    expect(og).toContain('${CARD_PRIVACY}');
    expect(og).not.toContain('agent');
  });
});
