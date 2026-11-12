// The frame of the site's text pages (/about, /legal): a bar of plain links (the viewer, the
// manual, About, the legal page), the page, and a footer with the research-use line and the
// author. Every address is relative to the page, so the staging base path holds; the viewer
// is "./", the page beside these. Static: no script of its own.
import React from 'react';
import { REPO_URL } from './links';
import { AUTHOR_CREDENTIAL, AUTHOR_NAME } from './sitePages';

export default function SitePage({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <div className="site-col">
        <nav className="site-nav" aria-label="CBCTScope pages">
          <a className="site-name" href="./">
            CBCTScope
          </a>
          <a href="./">Open the viewer</a>
          <a href="manual/index.html">User manual</a>
          <a href="about">About</a>
          <a href="legal">Legal notice</a>
        </nav>
        <main>{children}</main>
        <footer className="site-foot">
          <span className="site-posture">Research use only. Not a medical device.</span>
          <span>
            By <a href="about">{AUTHOR_NAME}</a>, {AUTHOR_CREDENTIAL}.
          </span>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            Source code
          </a>
        </footer>
      </div>
    </div>
  );
}
