'use client';
// The phone page's "Send this link to a computer or a colleague" (components/sitePages.ts PHONE_ACTIONS): a real
// mailto: link, progressively enhanced. Where the browser has the Web Share API, a tap opens the
// phone's own share sheet (AirDrop, Messages, Notes, Mail, Copy) with the site's name and
// canonical address, and the mail link is not followed. The share call is made in the click
// handler itself, since browsers require a user gesture for it. A cancelled sheet (AbortError)
// does nothing more; any other failure follows the mail link. Without JavaScript or without the
// API the link behaves as a plain mailto:. The page itself sends the address nowhere and stores and copies nothing.
// The handler is attached by React's hydration of the home page, which happens on a phone too
// (components/HomeViewer.tsx renders SiteIntro there and never loads the viewer).
import type { MouseEvent } from 'react';

export default function ShareLink({
  href,
  label,
  testId,
  className,
  share,
}: {
  href: string;
  label: string;
  testId: string;
  className?: string;
  share: { title: string; url: string };
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (typeof navigator.share !== 'function') return;
    e.preventDefault();
    navigator.share({ title: share.title, url: share.url }).catch((err: unknown) => {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      window.location.href = href;
    });
  };
  return (
    <a className={className} data-testid={testId} href={href} onClick={onClick}>
      {label}
    </a>
  );
}
