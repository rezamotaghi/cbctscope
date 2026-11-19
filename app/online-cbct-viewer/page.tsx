// /online-cbct-viewer: the site's questions and answers page. Each question is an h2 with its
// answer and links to the manual pages that cover it, rendered from components/siteQuestions.ts,
// and the same array is the page's FAQPage structured data. Static, plain prose (docs/posture.md:
// the first sentence names the viewer and its author).
import SitePage from '@/components/SitePage';
import { faqJsonLd, jsonLdText } from '@/components/jsonLd';
import { pageMetadata } from '@/components/siteMeta';
import { QA_DESCRIPTION, QA_LEAD, QA_TITLE } from '@/components/sitePages';
import { SITE_QUESTIONS } from '@/components/siteQuestions';

export const metadata = pageMetadata({
  title: QA_TITLE,
  description: QA_DESCRIPTION,
  path: '/online-cbct-viewer',
});

export default function Questions() {
  return (
    <SitePage>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(faqJsonLd(SITE_QUESTIONS)) }} />
      <h1>{QA_TITLE}</h1>
      <p>{QA_LEAD}</p>
      <p>
        Each answer links the part of the <a href="manual/index.html">user manual</a> that covers it.
      </p>
      {SITE_QUESTIONS.map((q) => (
        <section key={q.question}>
          <h2>{q.question}</h2>
          <p>{q.answer}</p>
          <p>
            {q.links.map((l, i) => (
              <span key={l.href}>
                {i > 0 ? ' and ' : ''}
                <a href={l.href}>{l.label}</a>
              </span>
            ))}
          </p>
        </section>
      ))}
    </SitePage>
  );
}
