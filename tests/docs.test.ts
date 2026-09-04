// Shrink-only size cap on AGENTS.md: it is read into every agent session, so it stays
// small and current-only. When it grows past the cap, trim the file; never raise the number.
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CAP = 6528;

describe('AGENTS.md', () => {
  it(`stays within its ${CAP}-byte cap`, () => {
    const size = statSync(fileURLToPath(new URL('../AGENTS.md', import.meta.url))).size;
    expect(size, 'AGENTS.md grew past its cap: trim it, never raise the cap').toBeLessThanOrEqual(CAP);
  });
});
