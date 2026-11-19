// The page title and the share card say what CBCTScope is: a viewer, who built it, that the
// scan stays in the browser, and last what the agent may do and who reads. The card is rendered from the site constants, never typed twice.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_AGENT, CARD_CLAIM, CARD_PRIVACY } from '@/components/siteCard.mjs';

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8');

describe('the title and the share card', () => {
  it('the page, Open Graph and Twitter titles are one line naming the viewer, the web build\'s and the local app\'s', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toContain(
      "const TITLE =\n  process.env.NEXT_PUBLIC_CBCTSCOPE_TARGET === 'web'\n    ? 'CBCTScope: free online CBCT and radiograph viewer'\n    : 'CBCTScope: CBCT and radiograph viewer in your browser';",
    );
    expect(layout).toMatch(/title: TITLE,/);
    expect(layout).toMatch(/openGraph: \{[^}]*title: TITLE,/);
    expect(layout).toMatch(/twitter: \{[^}]*title: TITLE,/);
  });

  it('the card carries the viewer and author line, then the privacy line, then the agent line', () => {
    expect(CARD_CLAIM).toBe('Local-first CBCT and 2D radiograph viewer, built by an oral and maxillofacial radiologist.');
    expect(CARD_PRIVACY).toBe('Your scan is read in the browser and never uploaded.');
    // the first two lines name no agent: the card opens with the viewer, as a viewer
    for (const line of [CARD_CLAIM, CARD_PRIVACY]) expect(line).not.toMatch(/\b(agent|AI|MCP|model)\b/i);
    // the third states the rule with its limit, word for word
    expect(CARD_AGENT).toBe('Agent-native: an AI agent can move the camera, the human reads.');
    const og = read('scripts/og.mjs');
    expect(og).toContain("from '../components/siteCard.mjs'");
    const order = ['${CARD_CLAIM}', '${CARD_PRIVACY}', '${CARD_AGENT}', 'Research use only. Not a medical device.'].map((t) => og.indexOf(t));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the text beside the card is the claim, then the agent line, and the card has its own file name', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toContain('const CARD_TEXT = `${SITE_CLAIM} ${CARD_AGENT}`;');
    expect(layout).toMatch(/openGraph: \{[^}]*description: CARD_TEXT,/);
    expect(layout).toMatch(/twitter: \{[^}]*description: CARD_TEXT,/);
    expect(read('components/siteAddress.mjs')).toContain("path: '/og-card.png'");
  });
});
