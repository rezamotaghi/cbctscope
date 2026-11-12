// /about: what CBCTScope is, who made it, how to cite it, the licence, the privacy summary,
// and links to the manual and the source. Static; the citation is read from CITATION.cff at
// build time. Plain prose (docs/posture.md: the first sentence names the viewer and its author).
import CitationBlock from '@/components/CitationBlock';
import SitePage from '@/components/SitePage';
import { jsonLdText, softwareJsonLd } from '@/components/jsonLd';
import { AUTHOR_ORCID, AUTHOR_URL, LICENSE_URL, RADIGRADE_URL, REPO_URL } from '@/components/links';
import { pageMetadata } from '@/components/siteMeta';
import { ABOUT_DESCRIPTION, ABOUT_LEAD, ABOUT_TITLE } from '@/components/sitePages';
import { readCitation } from '@/lib/server/citation';

export const metadata = pageMetadata({
  title: ABOUT_TITLE,
  description: ABOUT_DESCRIPTION,
  path: '/about',
});

export default function About() {
  const citation = readCitation();
  return (
    <SitePage>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(softwareJsonLd(citation)) }} />
      <h1>About CBCTScope</h1>
      <p>{ABOUT_LEAD}</p>
      <p>
        It reads cone-beam CT volumes in eight reading modes: MPR with 3D rendering, multi-slice grid, curved panoramic with
        nerve tracing, TMJ, freehand reslice, virtual cephalogram, region growing with airway analysis, and two-volume
        stitching. It reads 2D radiographs (panoramic, intraoral, CR and DX) in the same instrument, under the same display
        settings. It is free and open source, with no account and no upload.
      </p>
      <p>
        CBCTScope visualizes and navigates images and produces no findings or diagnoses. It is research software, not a
        medical device. An optional agent can move its camera on request, under one rule: the agent moves the camera and
        never produces findings; the human reads.
      </p>

      <h2>Who made it</h2>
      <p>
        CBCTScope is made by{' '}
        <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
          Dr. Reza Motaghi
        </a>
        , a board-certified oral and maxillofacial radiologist, who reads with it. He reads oral and maxillofacial imaging
        every day and also develops, evaluates and trains imaging AI. He is the creator of{' '}
        <a href={RADIGRADE_URL} target="_blank" rel="noopener noreferrer">
          Radigrade
        </a>
        , a registered protocol for grading AI-written radiograph reports. ORCID:{' '}
        <a href={AUTHOR_ORCID} target="_blank" rel="noopener noreferrer">
          0009-0005-3194-1879
        </a>
        .
      </p>

      <h2 id="cite">How to cite it</h2>
      <p>If you use CBCTScope in research, please cite it. The reference and the BibTeX entry below come from the repository&apos;s CITATION.cff file.</p>
      <CitationBlock citation={citation} />

      <h2>Licence</h2>
      <p>
        CBCTScope is free software under the{' '}
        <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">
          GNU Affero General Public License, version 3 or later
        </a>{' '}
        (AGPL-3.0-or-later).
      </p>

      <h2>Privacy</h2>
      <p>
        Scans you open are read in your browser tab, or on your computer in the desktop app, and are never uploaded; the
        site sets no cookies and runs no analytics. The site is hosted on GitHub Pages, whose servers receive your IP
        address as any web host does; the <a href="legal">legal notice</a> has the details.
      </p>

      <h2>More</h2>
      <ul>
        <li>
          <a href="manual/index.html">The user manual</a>, with a reading guide for each mode
        </li>
        <li>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            The source code
          </a>
        </li>
      </ul>
    </SitePage>
  );
}
