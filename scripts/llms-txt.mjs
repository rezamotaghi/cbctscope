// llms.txt for the web build (docs/web-build.md, section 14), written by scripts/build-web.mjs
// beside sitemap.xml and robots.txt, in the format of https://llmstxt.org: an H1 with the name,
// a blockquote with the README's claim, a short paragraph, then H2 sections of markdown links
// with a note after each. Everything in it is already said elsewhere: the claim and the
// research-use sentence (components/siteWords.mjs), the privacy line of the share card
// (components/siteCard.mjs), the title and description each exported page of the site carries,
// the manual's titles and descriptions (docs/manual/manifest.json), and the project's addresses
// (components/siteAddress.mjs). Every address is the production one. It is a text file, not a
// page: the sitemap does not list it and the page-view counter is never written into it.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTHOR_PROJECT_URL, CONCEPT_DOI, DOI_RESOLVER, REPO_URL, SITE_NAME, SITE_URL, canonicalUrl } from '../components/siteAddress.mjs';
import { CARD_PRIVACY } from '../components/siteCard.mjs';
import { HOME_RESEARCH, SITE_CLAIM } from '../components/siteWords.mjs';
import { pageName } from './manual-html.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** the file's name at the site's root */
export const LLMS_FILE = 'llms.txt';

/** the site's pages llms.txt lists first, as [exported file, link text] */
export const LLMS_SITE_PAGES = Object.freeze([
  ['index.html', 'The viewer'],
  ['online-cbct-viewer.html', 'Questions and answers'],
  ['about.html', 'About CBCTScope'],
  ['legal.html', 'Legal notice and privacy'],
]);

const decode = (s) =>
  s
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/**
 * An exported page's title and meta description.
 * @param {string} html
 */
export function pageHead(html) {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
  const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1];
  if (!title || !description) throw new Error('llms-txt: a page has no title or no meta description');
  return { title: decode(title), description: decode(description) };
}

/**
 * The text of llms.txt.
 * @param {{ pages: { url: string, text: string, title: string, description: string }[], manual: { title: string, description: string, chapters: { file: string, pageTitle: string, description: string }[] } }} input
 */
export function llmsText({ pages, manual }) {
  const host = SITE_URL.replace(/^https:\/\//, '');
  const link = (text, url, note) => `- [${text}](${url}): ${note}`;
  return [
    `# ${SITE_NAME}`,
    '',
    `> ${SITE_CLAIM}`,
    '',
    `${SITE_NAME} runs in the browser at ${host} and as a desktop app for macOS and Windows. ${CARD_PRIVACY} ${HOME_RESEARCH}`,
    '',
    '## The site',
    '',
    ...pages.map((p) => link(p.text, p.url, `${p.title}. ${p.description}`)),
    '',
    '## User manual',
    '',
    link(manual.title, canonicalUrl('/manual/'), manual.description),
    ...manual.chapters.map((c) => link(c.pageTitle, canonicalUrl(`/manual/${pageName(c.file)}`), c.description)),
    '',
    '## Source and citation',
    '',
    link('Source code', REPO_URL, 'the repository, under the GNU Affero General Public License, version 3 or later.'),
    link('Citation', `${DOI_RESOLVER}${CONCEPT_DOI}`, 'the concept DOI on Zenodo, which resolves to the newest archived version.'),
    link("The author's project page", AUTHOR_PROJECT_URL, `Reza Motaghi's page on ${SITE_NAME}.`),
    '',
  ].join('\n');
}

/**
 * Write llms.txt into the export, from its pages and the manual's manifest; returns its text.
 * @param {string} outDir
 * @param {string} [root]
 */
export function writeLlmsTxt(outDir, root = ROOT) {
  const manual = JSON.parse(readFileSync(path.join(root, 'docs/manual/manifest.json'), 'utf8'));
  const pages = LLMS_SITE_PAGES.map(([file, text]) => ({
    url: canonicalUrl(file === 'index.html' ? '/' : `/${file.replace(/\.html$/, '')}`),
    text,
    ...pageHead(readFileSync(path.join(outDir, file), 'utf8')),
  }));
  const text = llmsText({ pages, manual });
  writeFileSync(path.join(outDir, LLMS_FILE), text);
  return text;
}
