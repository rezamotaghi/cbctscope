// The home page below 768 px of width (docs/web-build.md, section 7; manual section 2.1): what
// CBCTScope is, one picture of it, where to read with it, and three full-width controls. The
// viewer is not mounted at that width (components/HomeViewer.tsx). The exported HTML carries
// this beside the intro, and app/globals.css shows the one that fits the width before any
// script runs, so a phone never sees the viewer squeezed. No hooks: it renders the same on the
// server and in the browser.
import React from 'react';
import { AUTHOR_URL } from './links';
import {
  HOME_AUTHOR_NAME,
  HOME_LINKS,
  PHONE_ACTIONS,
  PHONE_AUTHOR,
  PHONE_COMPUTER,
  PHONE_LEAD,
  PHONE_PRIVACY,
  PHONE_RESEARCH,
  PHONE_STILL,
} from './sitePages';

/** the site's own pages in the footer: About, and the legal notice every page must reach */
const FOOT_LINKS = HOME_LINKS.filter((l) => l.href === 'about' || l.href === 'legal');

export default function PhoneLanding() {
  const at = PHONE_AUTHOR.indexOf(HOME_AUTHOR_NAME);
  return (
    <div className="site landing" data-testid="phone-landing">
      <div className="site-col">
        <h1>CBCTScope</h1>
        <p className="landing-posture">{PHONE_RESEARCH}</p>
        <p>{PHONE_LEAD}</p>
        <p>{PHONE_PRIVACY}</p>
        {/* lazy: in the served page at a desktop width this block is not displayed, and a lazy
            image that is not displayed is not fetched */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a static export: no image optimiser, the still is served as it is */}
        <img className="landing-still" loading="lazy" src={PHONE_STILL.src} width={PHONE_STILL.width} height={PHONE_STILL.height} alt={PHONE_STILL.alt} />
        <p className="landing-computer">{PHONE_COMPUTER}</p>
        <nav className="landing-actions" aria-label="CBCTScope on a computer">
          {PHONE_ACTIONS.map((a) =>
            a.external ? (
              <a key={a.href} className="landing-action" data-testid={a.testId} href={a.href} target="_blank" rel="noopener noreferrer">
                {a.label}
              </a>
            ) : (
              <a key={a.href} className="landing-action" data-testid={a.testId} href={a.href}>
                {a.label}
              </a>
            ),
          )}
        </nav>
        <footer className="landing-foot">
          <p>
            {PHONE_AUTHOR.slice(0, at)}
            <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer">
              {HOME_AUTHOR_NAME}
            </a>
            {PHONE_AUTHOR.slice(at + HOME_AUTHOR_NAME.length)}
          </p>
          <p>
            {FOOT_LINKS.map((l, i) => (
              <React.Fragment key={l.href}>
                {i > 0 && ' · '}
                <a href={l.href}>{l.label}</a>
              </React.Fragment>
            ))}
          </p>
        </footer>
      </div>
    </div>
  );
}
