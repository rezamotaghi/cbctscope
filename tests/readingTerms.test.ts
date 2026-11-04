// The reading-term guard (lib/shared/readingTerms.mjs): a word filter over the model's prose,
// not a judge. Five sentences a report would contain must be replaced; five navigation answers
// must pass unchanged.
import { describe, expect, it } from 'vitest';
import { guardModelText, hasReadingTerms, MODEL_TEXT_HEADING, READING_REPLACEMENT } from '../lib/shared/readingTerms.mjs';

const POSITIVE = [
  'There is a well-defined radiolucency at the apex of 36, consistent with a periapical lesion.',
  'The left condyle shows a fracture line through the neck.',
  'A unilocular cyst is suggestive of an odontogenic keratocyst.',
  'Findings: external root resorption of 47 adjacent to the impacted 48.',
  'This could be a tumour; the diagnosis needs a biopsy.',
];

const NEGATIVE = [
  'TMJ mode is on screen at the current window.',
  'Switched to the bone window; the axial pane is at slice 120.',
  'The left condyle is now centred in the sagittal pane.',
  'I saved the view as "Left TMJ" and took a snapshot.',
  'Pano mode is open with the arch at 50 percent.',
];

describe('the reading-term guard', () => {
  for (const s of POSITIVE) {
    it(`replaces: ${s}`, () => {
      expect(hasReadingTerms(s)).toBe(true);
      expect(guardModelText(s)).toEqual({ text: READING_REPLACEMENT, replaced: true });
    });
  }
  for (const s of NEGATIVE) {
    it(`passes: ${s}`, () => {
      expect(hasReadingTerms(s)).toBe(false);
      expect(guardModelText(s)).toEqual({ text: s, replaced: false });
    });
  }

  it('says what it does and labels the block it guards', () => {
    expect(READING_REPLACEMENT).toBe(
      'The model offered an interpretation. CBCTScope does not display readings; ask for a view, not an opinion.',
    );
    expect(MODEL_TEXT_HEADING).toBe('Model text. Not a reading, not a finding.');
  });
});
