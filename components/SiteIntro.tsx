// The home page's state until the viewer mounts (docs/web-build.md, section 7): a heading, what
// CBCTScope is and who made it, where scans are read, the research-use sentence, and plain
// links to the manual, the eight reading guides, the About and legal pages, the source and the
// author's page. It is the loading state of the client-only viewer (components/HomeViewer.tsx),
// so the exported HTML carries it before any script runs; the viewer then takes its place.
// No hooks: it renders the same on the server and in the browser.
import React from 'react';
import { AUTHOR_URL } from './links';
import { HOME_AUTHOR_NAME, HOME_LEAD, HOME_LINKS, HOME_NOSCRIPT, HOME_PRIVACY_LOCAL, HOME_PRIVACY_WEB, HOME_RESEARCH, type SiteLink } from './sitePages';

const WEB = process.env.NEXT_PUBLIC_CBCTSCOPE_TARGET === 'web';

export function SiteLinkList({ links, className }: { links: readonly SiteLink[]; className?: string }) {
  return (
    <ul className={className ?? 'site-links'}>
      {links.map((l) => (
        <li key={l.href}>
          {l.external ? (
            <a href={l.href} target="_blank" rel="noopener noreferrer">
              {l.label}
            </a>
          ) : (
            <a href={l.href}>{l.label}</a>
          )}
        </li>
      ))}
    </ul>
  );
}

/** a sentence with the author's name as the link to his site, opened as the other outbound links are */
function LinkedName(sentence: string, name: string) {
  const at = sentence.indexOf(name);
  return (
    <>
      {sentence.slice(0, at)}
      <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
        {name}
      </a>
      {sentence.slice(at + name.length)}
    </>
  );
}

export default function SiteIntro() {
  return (
    <div className="site site-intro" data-testid="site-intro">
      <div className="site-col">
        <h1>CBCTScope</h1>
        <p>{LinkedName(HOME_LEAD, HOME_AUTHOR_NAME)}</p>
        <p>{WEB ? HOME_PRIVACY_WEB : HOME_PRIVACY_LOCAL}</p>
        <p className="site-posture">{HOME_RESEARCH}</p>
        <p className="site-loading" style={{ color: 'var(--text-dim)' }}>
          The viewer is loading.
        </p>
        {/* shown only without JavaScript: app/page.tsx's noscript block reveals it and hides the loading line */}
        <p className="site-nojs">{HOME_NOSCRIPT}</p>
        <nav aria-label="CBCTScope pages">
          <SiteLinkList links={HOME_LINKS} />
        </nav>
      </div>
    </div>
  );
}
