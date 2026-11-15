// "Cite this software" follows CITATION.cff (components/citation.ts): the reference line and the
// BibTeX entry take the authors, title, version and year from the file, so a changed version or
// year changes the text, and the file the repository ships produces both. The DOI is always the
// concept DOI, whatever the file's doi: holds: the site can be updated between releases, so it
// never cites one version's archive.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { citationFrom } from '../components/citation';
import { CONCEPT_DOI } from '../components/links';
import { softwareJsonLd } from '../components/jsonLd';

const cff = readFileSync(path.join(process.cwd(), 'CITATION.cff'), 'utf8');
const field = (key: string) => new RegExp(`^${key}:[ \\t]*"?([^"\\n]*)"?$`, 'm').exec(cff)?.[1] ?? '';

describe('the citation, from CITATION.cff', () => {
  it('the repository file gives a reference line and a BibTeX entry with its title, version and year, and the concept DOI', () => {
    const c = citationFrom(cff);
    expect(c.title).toBe(field('title'));
    expect(c.version).toBe(field('version'));
    expect(c.doi).toBe(CONCEPT_DOI);
    expect(CONCEPT_DOI).toBe('10.5281/zenodo.21431452');
    expect(c.year).toBe(field('date-released').slice(0, 4));
    expect(c.reference).toBe(`Motaghi, R. (${c.year}). ${c.title} (Version ${c.version}) [Computer software]. https://doi.org/${c.doi}`);
    expect(c.bibtex).toContain('@software{motaghi_');
    expect(c.bibtex).toContain('author    = {Motaghi, Reza}');
    expect(c.bibtex).toContain(`version   = {${c.version}}`);
    expect(c.bibtex).toContain(`doi       = {${c.doi}}`);
    expect(c.bibtex).toContain(`title     = {{${c.title}}}`);
    expect(`${c.reference}\n${c.bibtex}`).not.toMatch(/[—–]/);
  });

  it('reads the file the same with Windows or old Mac line endings', () => {
    const lf = citationFrom(cff.replace(/\r\n?/g, '\n'));
    for (const eol of ['\r\n', '\r']) {
      const c = citationFrom(cff.replace(/\r\n?/g, '\n').replace(/\n/g, eol));
      expect(c).toEqual(lf);
    }
    expect(lf.authors.length).toBeGreaterThan(0);
  });

  it('the BibTeX entry escapes its specials, the backslash included', () => {
    const c = citationFrom(cff.replace(/^title: .*$/m, 'title: A\\B {x} 50% R&D $1 #2 a_b'));
    expect(c.bibtex).toContain('title     = {{A\\textbackslash{}B \\{x\\} 50\\% R\\&D \\$1 \\#2 a\\_b}}');
  });

  it('follows the file: a changed version or release date changes the text; a version DOI in the file does not', () => {
    const fixture = cff
      .replace(/^version: .*$/m, 'version: 9.8.7')
      .replace(/^date-released: .*$/m, 'date-released: 2031-02-03')
      .replace(/^doi: .*$/m, 'doi: 10.5281/zenodo.1234567');
    const c = citationFrom(fixture);
    expect(c.reference).toContain('(2031)');
    expect(c.reference).toContain('(Version 9.8.7)');
    expect(c.reference.endsWith(`https://doi.org/${CONCEPT_DOI}`)).toBe(true);
    expect(`${c.reference}\n${c.bibtex}`).not.toContain('1234567');
    expect(c.bibtex).toContain('version   = {9.8.7}');
    expect(c.bibtex).toContain('year      = {2031}');
    expect(c.bibtex).toContain(`doi       = {${CONCEPT_DOI}}`);
    expect(c.bibtex).not.toContain(field('version'));
  });

  it('names every author, and refuses a file without the fields a citation needs', () => {
    const two = cff.replace(
      /^authors:\n/m,
      'authors:\n  - family-names: Example\n    given-names: Ada Lovelace\n',
    );
    const c = citationFrom(two);
    expect(c.reference.startsWith('Example, A. L., & Motaghi, R. (')).toBe(true);
    expect(c.bibtex).toContain('author    = {Example, Ada Lovelace and Motaghi, Reza}');
    // the file's doi: is not read: without it the citation still carries the concept DOI
    expect(citationFrom(cff.replace(/^doi: .*$/m, '')).doi).toBe(CONCEPT_DOI);
    expect(() => citationFrom(cff.replace(/^version: .*$/m, ''))).toThrow(/version/);
  });

  it('the structured data carries the concept DOI, the package version and the author, and nothing medical', () => {
    const c = citationFrom(cff);
    const ld = softwareJsonLd(c) as Record<string, unknown> & { identifier: { value: string }; author: { name: string; url: string; sameAs: string[] } };
    const version = (JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version;
    expect(ld['@type']).toBe('WebApplication');
    expect(ld.softwareVersion).toBe(version);
    expect(ld.isAccessibleForFree).toBe(true);
    expect(ld.identifier.value).toBe(CONCEPT_DOI);
    expect(softwareJsonLd(citationFrom(cff.replace(/^doi: .*$/m, 'doi: 10.5281/zenodo.1234567'))).identifier).toEqual(ld.identifier);
    expect(ld.author).toMatchObject({ name: 'Reza Motaghi', url: 'https://rezamotaghi.com' });
    expect(ld.author.sameAs).toEqual(['https://orcid.org/0009-0005-3194-1879', 'https://github.com/rezamotaghi']);
    const text = JSON.stringify(ld);
    expect(text).not.toMatch(/aggregateRating|review|Medical/i);
  });
});
