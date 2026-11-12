// /legal: the legal notice (in Austrian terms the Impressum and the disclosure under section 25
// of the Mediengesetz), privacy, the research-use status, and the licence and warranty. These
// parts and nothing more; no street address (the owner's decision), no promotional sentence.
import SitePage from '@/components/SitePage';
import { DSB_URL, GITHUB_PRIVACY_URL, LICENSE_URL } from '@/components/links';
import { CONTACT_EMAIL } from '@/components/site';
import { pageMetadata } from '@/components/siteMeta';
import { LEGAL_DESCRIPTION, LEGAL_PURPOSE, LEGAL_TITLE } from '@/components/sitePages';

export const metadata = pageMetadata({ title: LEGAL_TITLE, description: LEGAL_DESCRIPTION, path: '/legal' });

const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

export default function Legal() {
  return (
    <SitePage>
      <h1>Legal notice and privacy</h1>

      <h2 id="legal-notice">Legal notice</h2>
      <h3>Impressum and disclosure under section 25 of the Mediengesetz (Austria)</h3>
      <p>{LEGAL_PURPOSE}</p>
      <ul>
        <li>Media owner and publisher: Reza Motaghi</li>
        <li>Vienna, Austria</li>
        <li>Contact: {mail}</li>
      </ul>

      <h2 id="privacy">Privacy</h2>
      <p>
        Scans you open, and the marks you make on them, never leave your browser: the viewer reads them in the tab and sends
        them nowhere. The site sets no cookies, runs no analytics and has no accounts.
      </p>
      <p>
        Your settings and marks are kept in your browser&apos;s own storage on your device. Clearing this site&apos;s data in
        the browser removes them.
      </p>
      <p>
        The site is hosted on GitHub Pages. GitHub&apos;s servers receive your IP address and the details of each request, as
        any web host does, and GitHub handles them under its own{' '}
        <a href={GITHUB_PRIVACY_URL} target="_blank" rel="noopener noreferrer">
          privacy statement
        </a>
        .
      </p>
      <p>
        The optional agent is off until you switch it on. When you do, your prompts and snapshots of the view go directly from
        your browser to the model provider you chose, under your own account with that provider; this site receives nothing.
      </p>
      <p>
        Under the GDPR you have the right of access, rectification, erasure, restriction of processing, data portability and
        objection, where they apply. You also have the right to lodge a complaint with the Austrian data protection authority,
        the Datenschutzbehörde (
        <a href={DSB_URL} target="_blank" rel="noopener noreferrer">
          dsb.gv.at
        </a>
        ).
      </p>
      <p>Write to {mail} about any of this.</p>

      <h2 id="research-software">Research software</h2>
      <p>
        CBCTScope is research software and not a medical device. It displays and navigates images and produces no findings,
        interpretations or diagnoses.
      </p>

      <h2 id="licence">Licence and warranty</h2>
      <p>
        CBCTScope is licensed under the{' '}
        <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">
          GNU Affero General Public License, version 3 or later
        </a>{' '}
        (AGPL-3.0-or-later). It is provided without warranty, as the licence states.
      </p>
    </SitePage>
  );
}
