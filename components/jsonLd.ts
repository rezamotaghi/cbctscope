// The structured data of the site's pages (schema.org JSON-LD). On the home page and the About
// page, the viewer as one WebApplication record: its @id, the name and description from the
// site constants, category and systems, free (isAccessibleForFree and a zero-price offer), the
// licence, the version from package.json, the address, the installers' fixed addresses
// (components/downloads.ts), the user manual, the manual's MPR still as its screenshot, the
// eight reading modes as its features (their names in docs/manual/manifest.json), the source,
// the concept DOI (the citation's, components/citation.ts), the author's project page, and the
// author as a Person with the @id his own site gives him, his name, title, site, ORCID and
// GitHub profile (CITATION.cff and the repository address). The home page adds the WebSite
// record. On the questions and answers page, its questions and answers as a FAQPage, from the
// array the page renders. No ratings, no reviews, no medical types.
//
// Each block is a data block (type="application/ld+json"): the browser never executes it, and
// scripts/build-web.mjs gives it no script-src hash, so the policy stays as strict as before.
import manifest from '@/docs/manual/manifest.json';
import pkg from '@/package.json';
import type { Citation } from './citation';
import { INSTALLER_NAMES, installerUrl } from './downloads';
import type { SiteQuestion } from './siteQuestions';
import { AUTHOR_GITHUB, AUTHOR_ORCID, AUTHOR_PROJECT_URL, AUTHOR_URL, LICENSE_URL, REPO_URL } from './links';
import { SITE_CLAIM, SITE_NAME, canonicalUrl } from './site';
import { AUTHOR_PERSON_ID, SOFTWARE_ID, WEBSITE_ID } from './siteAddress.mjs';
import { PHONE_STILL } from './sitePages';

/** the eight reading modes by name, as the manual's chapters 8.1 to 8.8 title them ("8.1 · MPR") */
export const READING_MODE_NAMES: readonly string[] = manifest.chapters
  .filter((c) => c.file.startsWith('docs/reading-modes/'))
  .map((c) => c.title.split(' · ')[1]);

/** the author, as the home and About pages describe him */
export const AUTHOR_PERSON = {
  '@type': 'Person',
  '@id': AUTHOR_PERSON_ID,
  name: 'Reza Motaghi',
  honorificPrefix: 'Dr.',
  alternateName: 'Dr. Reza Motaghi',
  jobTitle: 'Board-certified oral and maxillofacial radiologist',
  url: AUTHOR_URL,
  sameAs: [AUTHOR_ORCID, AUTHOR_GITHUB],
} as const;

export function softwareJsonLd(citation: Citation): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': SOFTWARE_ID,
    name: SITE_NAME,
    description: SITE_CLAIM,
    url: canonicalUrl('/'),
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any (web browser); macOS; Windows',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    license: LICENSE_URL,
    softwareVersion: pkg.version,
    downloadUrl: Object.values(INSTALLER_NAMES).map(installerUrl),
    softwareHelp: { '@type': 'CollectionPage', '@id': canonicalUrl('/manual/'), name: manifest.title, url: canonicalUrl('/manual/') },
    screenshot: canonicalUrl(`/${PHONE_STILL.src}`),
    featureList: READING_MODE_NAMES,
    codeRepository: REPO_URL,
    sameAs: [AUTHOR_PROJECT_URL, REPO_URL, citation.doiUrl],
    identifier: { '@type': 'PropertyValue', propertyID: 'DOI', value: citation.doi, url: citation.doiUrl },
    author: AUTHOR_PERSON,
  };
}

/** the site itself: the home page's second record */
export function websiteJsonLd(): Record<string, unknown> {
  return { '@context': 'https://schema.org', '@type': 'WebSite', '@id': WEBSITE_ID, name: SITE_NAME, url: canonicalUrl('/') };
}

/** the questions and answers page's FAQPage: each question with its answer, as the page shows them */
export function faqJsonLd(questions: readonly SiteQuestion[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: { '@type': 'Answer', text: q.answer },
    })),
  };
}

/** the JSON for a <script type="application/ld+json"> body: no "<" can close the element */
export const jsonLdText = (data: Record<string, unknown>) => JSON.stringify(data).replace(/</g, '\\u003c');
