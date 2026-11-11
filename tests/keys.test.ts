// The viewer's single-letter keys leave every Cmd, Ctrl and Alt chord to the browser and the
// desktop app's menu, in every handler that listens on the window.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isChord } from '@/components/cbct/keys';

const none = { metaKey: false, ctrlKey: false, altKey: false };

describe('chords are not viewer keys', () => {
  it('isChord is true for Cmd, Ctrl and Alt, false for a bare key', () => {
    expect(isChord(none)).toBe(false);
    expect(isChord({ ...none, metaKey: true })).toBe(true);
    expect(isChord({ ...none, ctrlKey: true })).toBe(true);
    expect(isChord({ ...none, altKey: true })).toBe(true);
  });

  it('both window key handlers that act on letters check for a chord first', () => {
    for (const file of ['components/cbct/CbctApp.tsx', 'components/cbct/CbctViewport.tsx']) {
      const src = readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(src, `${file} must return early on a chord`).toMatch(/if \(isChord\(e\)\) return;/);
    }
  });
});
