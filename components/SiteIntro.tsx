// The home page's state until the viewer mounts (docs/web-build.md, section 7): a heading, what
// CBCTScope is and who made it, where scans are read, the research-use sentence, and plain
// links to the manual, the eight reading guides, the About and legal pages, the source and the
// author's page. It is the loading state of the client-only viewer (components/HomeViewer.tsx),
// so the exported HTML carries it before any script runs; the viewer then takes its place.
// In the web build it is also the phone page: the same heading and sentences, rendered once,
// then a picture, the line that CBCTScope reads scans on a computer, three full-width controls
// and a short row of links. app/globals.css shows those, and hides the loading line and the long
// list, on a phone (components/phone.ts), from the first paint; on a phone the viewer is never
// mounted. No hooks: it renders the same on the server and in the browser. The phone page is
// still hydrated (HomeViewer renders this component on a phone), which is how the share control's
// click handler (components/ShareLink.tsx) is attached there.
import React from 'react';
import { AUTHOR_URL } from './links';
import ShareLink from './ShareLink';
import {
  HOME_AUTHOR_NAME,
  HOME_LEAD,
  HOME_LINKS,
  HOME_NOSCRIPT,
  HOME_PRIVACY_LOCAL,
  HOME_PRIVACY_WEB,
  HOME_RESEARCH,
  PHONE_ACTIONS,
  PHONE_COMPUTER,
  PHONE_LINKS,
  PHONE_STILL,
  type SiteLink,
} from './sitePages';

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
      <main className="site-col">
        <h1>CBCTScope</h1>
        <p>{LinkedName(HOME_LEAD, HOME_AUTHOR_NAME)}</p>
        <p>{WEB ? HOME_PRIVACY_WEB : HOME_PRIVACY_LOCAL}</p>
        <p className="site-posture">{HOME_RESEARCH}</p>
        <p className="site-loading" style={{ color: 'var(--text-dim)' }}>
          The viewer is loading.
        </p>
        {/* shown only without JavaScript: app/page.tsx's noscript block reveals it and hides the loading line */}
        <p className="site-nojs">{HOME_NOSCRIPT}</p>
        <nav aria-label="CBCTScope pages" className="intro-links">
          <SiteLinkList links={HOME_LINKS} />
        </nav>
        {WEB && <PhonePart />}
      </main>
    </div>
  );
}

/** the phone page's own part, after the shared heading and sentences; shown on a phone only */
function PhonePart() {
  return (
    <div className="phone-page" data-testid="phone-landing">
      {/* lazy: where this part is not displayed (every device but a phone) a lazy image is not fetched */}
      {/* eslint-disable-next-line @next/next/no-img-element -- a static export: no image optimiser, the still is served as it is */}
      <img className="phone-still" loading="lazy" src={PHONE_STILL.src} width={PHONE_STILL.width} height={PHONE_STILL.height} alt={PHONE_STILL.alt} />
      <p className="phone-computer">{PHONE_COMPUTER}</p>
      <nav className="phone-actions" aria-label="CBCTScope on a computer">
        {PHONE_ACTIONS.map((a) =>
          a.share ? (
            <ShareLink key={a.href} className="phone-action" testId={a.testId} href={a.href} label={a.label} share={a.share} />
          ) : a.external ? (
            <a key={a.href} className="phone-action" data-testid={a.testId} href={a.href} target="_blank" rel="noopener noreferrer">
              {a.label}
            </a>
          ) : (
            <a key={a.href} className="phone-action" data-testid={a.testId} href={a.href}>
              {a.label}
            </a>
          ),
        )}
      </nav>
      <p className="phone-links">
        {PHONE_LINKS.map((l, i) => (
          <React.Fragment key={l.href}>
            {i > 0 && ' · '}
            {l.external ? (
              <a href={l.href} target="_blank" rel="noopener noreferrer">
                {l.label}
              </a>
            ) : (
              <a href={l.href}>{l.label}</a>
            )}
          </React.Fragment>
        ))}
      </p>
    </div>
  );
}
