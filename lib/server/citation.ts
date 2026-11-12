// CITATION.cff read at build time, for the pages that show the citation (app/page.tsx hands it
// to the viewer's Cite dialogue; app/about/page.tsx shows it). Server components only: the
// static export runs them once, while it renders the pages, so the browser fetches nothing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { citationFrom, type Citation } from '@/components/citation';

export function readCitation(): Citation {
  return citationFrom(readFileSync(path.join(process.cwd(), 'CITATION.cff'), 'utf8'));
}
