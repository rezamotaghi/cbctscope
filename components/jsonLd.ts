// The structured data of the home page and the About page (schema.org JSON-LD): the viewer, its
// author and its DOI as one record. Only what the repository states: the name and description
// from the site constants, the version from package.json, the licence, the source, the DOI
// CITATION.cff names, and the author with his ORCID and GitHub profile (CITATION.cff and the
// repository address). No ratings, no reviews, no medical types.
//
// The block is a data block (type="application/ld+json"): the browser never executes it, and
// scripts/build-web.mjs gives it no script-src hash, so the policy stays as strict as before.
import pkg from '@/package.json';
import type { Citation } from './citation';
import { AUTHOR_GITHUB, AUTHOR_ORCID, AUTHOR_URL, LICENSE_URL, REPO_URL } from './links';
import { SITE_CLAIM, SITE_NAME, canonicalUrl } from './site';

export function softwareJsonLd(citation: Citation): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_NAME,
    description: SITE_CLAIM,
    url: canonicalUrl('/'),
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any (web browser); macOS; Windows',
    isAccessibleForFree: true,
    license: LICENSE_URL,
    softwareVersion: pkg.version,
    codeRepository: REPO_URL,
    identifier: { '@type': 'PropertyValue', propertyID: 'DOI', value: citation.doi, url: citation.doiUrl },
    author: {
      '@type': 'Person',
      name: 'Reza Motaghi',
      url: AUTHOR_URL,
      sameAs: [AUTHOR_ORCID, AUTHOR_GITHUB],
    },
  };
}

/** the JSON for a <script type="application/ld+json"> body: no "<" can close the element */
export const jsonLdText = (data: Record<string, unknown>) => JSON.stringify(data).replace(/</g, '\\u003c');
