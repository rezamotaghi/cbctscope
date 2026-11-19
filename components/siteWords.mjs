// Two sentences the site says in several places, plain JavaScript so the build scripts read
// them too: the README's one-line claim (the share card's text, the structured data, llms.txt)
// and the research-use sentence (the home page before the viewer, llms.txt). components/site.ts
// and components/sitePages.ts re-export them.

/** the README's one-line claim */
export const SITE_CLAIM =
  'A complete, local-first CBCT and 2D radiograph viewer, built by a board-certified oral and maxillofacial radiologist.';

/** the research-use sentence */
export const HOME_RESEARCH = 'CBCTScope is research software and not a medical device: it displays images and produces no findings or diagnoses.';
