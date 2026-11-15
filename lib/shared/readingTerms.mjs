// The reading-term guard of the in-page agent (docs/mcp.md, threat model; manual section 9.6).
// A model may answer in words; CBCTScope shows those words only in a labelled block, and when
// they carry report vocabulary it shows a fixed sentence instead. This is a word filter, not a
// judge: it catches the obvious vocabulary of a radiology report and nothing subtler, and a
// paraphrase passes it. The fence remains the clinician's: the viewer moves the camera, the
// human reads.
// Plain ESM so the browser bundle and any Node caller share one list.

/**
 * Report vocabulary, as regular expressions over lower-cased text. Word stems cover the
 * obvious variants (lesion, lesions; fracture, fractured; resorption, resorbed; and so on).
 * @type {RegExp[]}
 */
export const READING_TERMS = [
  /\bradiolucen(?:t|ts|cy|cies|ce)\b/,
  /\bradio-?opa(?:que|city|cities)\b/,
  /\bradiopa(?:que|city|cities)\b/,
  /\blesions?\b/,
  /\bfractur(?:e|es|ed|ing)\b/,
  /\bcysts?\b|\bcystic\b/,
  /\btumou?rs?\b/,
  /\bcarcinomas?\b/,
  /\bcaries\b|\bcarious\b/,
  /\bperiapical\b/,
  /\bimpact(?:ion|ions|ed)\b/,
  /\bresor(?:ption|ptions|bed|bing|ptive)\b/,
  /\bpatholog(?:y|ies|ic|ical)\b/,
  /\bdiagnos(?:is|es|e|ed|ing|tic)\b/,
  /\bconsistent with\b/,
  /\bsuggestive of\b/,
  /\bfindings?\b/,
];

/** the heading of the panel's block that holds the model's words, and nothing else */
export const MODEL_TEXT_HEADING = 'Model text. Not a reading, not a finding.';

/** what the panel shows instead of model text that matched */
export const READING_REPLACEMENT =
  'The model offered an interpretation. CBCTScope does not display readings; ask for a view, not an opinion.';

/**
 * True when the text carries report vocabulary.
 * @param {string} text
 * @returns {boolean}
 */
export function hasReadingTerms(text) {
  const t = String(text ?? '').toLowerCase();
  return READING_TERMS.some((re) => re.test(t));
}

/**
 * The text the panel may show: unchanged, or the fixed replacement when it matched.
 * @param {string} text
 * @returns {{ text: string, replaced: boolean }}
 */
export function guardModelText(text) {
  return hasReadingTerms(text) ? { text: READING_REPLACEMENT, replaced: true } : { text: String(text ?? ''), replaced: false };
}
