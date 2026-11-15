// "Cite this software": the plain reference line and the BibTeX entry, derived from
// CITATION.cff, the one source of truth. The About page and app/page.tsx read the file at
// build time (lib/server/citation.ts) and hand its text to citationFrom; nothing is fetched.
//
// The DOI is the one CITATION.cff names. The release ritual (AGENTS.md) resets it to the
// concept DOI in the version-bump commit, and the site is built from the release tag, which
// is that commit, so every published build cites the concept DOI (it resolves to the latest
// version); the version line says which release the reader used.
import { DOI_RESOLVER } from './links';

export interface CitationAuthor {
  family: string;
  given: string;
}

export interface Citation {
  title: string;
  authors: CitationAuthor[];
  version: string;
  year: string;
  doi: string;
  /** the DOI as a link */
  doiUrl: string;
  /** the plain reference line, the DOI written out as its link */
  reference: string;
  /** a BibTeX @software entry */
  bibtex: string;
}

const unquote = (v: string) => v.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');

/** a top-level scalar field of a CITATION.cff file, or '' */
function field(cff: string, key: string): string {
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(cff);
  return m ? unquote(m[1]) : '';
}

/** the authors list: each `- family-names:` item with its `given-names:` */
function authors(cff: string): CitationAuthor[] {
  const start = /^authors:\s*$/m.exec(cff);
  if (!start) return [];
  const out: CitationAuthor[] = [];
  let current: CitationAuthor | null = null;
  for (const line of cff.slice(start.index + start[0].length).split('\n')) {
    if (line.trim() === '') continue;
    if (!/^\s/.test(line)) break; // the next top-level key
    const item = /^\s*-\s+(.*)$/.exec(line);
    const body = item ? item[1] : line.trim();
    if (item) {
      current = { family: '', given: '' };
      out.push(current);
    }
    const kv = /^([\w-]+):\s*(.*)$/.exec(body);
    if (!kv || !current) continue;
    if (kv[1] === 'family-names') current.family = unquote(kv[2]);
    if (kv[1] === 'given-names') current.given = unquote(kv[2]);
  }
  return out.filter((a) => a.family);
}

const initials = (given: string) =>
  given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((g) => `${g[0]}.`)
    .join(' ');

/** "Motaghi, R.", "Motaghi, R., & Other, A." */
function referenceAuthors(list: CitationAuthor[]): string {
  const names = list.map((a) => (a.given ? `${a.family}, ${initials(a.given)}` : a.family));
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
}

/** BibTeX braces and specials escaped in a field value; a backslash is written as its own command */
const bib = (s: string) => s.replace(/[\\{}%&$#_]/g, (c) => (c === '\\' ? '\\textbackslash{}' : `\\${c}`));

/**
 * The citation a CITATION.cff text describes.
 * @throws when the file lacks a title, an author, a version, a release date or a DOI
 */
export function citationFrom(source: string): Citation {
  // a file checked out or saved with CRLF or CR line endings reads the same
  const cff = source.replace(/\r\n?/g, '\n');
  const title = field(cff, 'title');
  const list = authors(cff);
  const version = field(cff, 'version');
  const year = /^(\d{4})-/.exec(field(cff, 'date-released'))?.[1] ?? '';
  const doi = field(cff, 'doi');
  const missing = Object.entries({ title, authors: list.length ? 'x' : '', version, year, doi })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`CITATION.cff: missing ${missing.join(', ')}`);
  const doiUrl = `${DOI_RESOLVER}${doi}`;
  const reference = `${referenceAuthors(list)} (${year}). ${title} (Version ${version}) [Computer software]. ${doiUrl}`;
  const key = `${list[0].family.toLowerCase().replace(/[^a-z0-9]/g, '')}_${year}_cbctscope`;
  const bibtex = [
    `@software{${key},`,
    `  author    = {${list.map((a) => bib(a.given ? `${a.family}, ${a.given}` : a.family)).join(' and ')}},`,
    `  title     = {{${bib(title)}}},`,
    `  year      = {${year}},`,
    `  version   = {${bib(version)}},`,
    `  doi       = {${bib(doi)}},`,
    `  url       = {${doiUrl}},`,
    '}',
  ].join('\n');
  return { title, authors: list, version, year, doi, doiUrl, reference, bibtex };
}
