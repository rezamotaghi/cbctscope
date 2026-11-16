'use client';
// The Help menu's "Share CBCTScope": the site's name and canonical address, and nothing of the
// scan on screen. Where the browser has the Web Share API, the system's share sheet opens and
// the menu closes once the sheet is done; a cancelled sheet does nothing more. Where there is no
// such API, in the desktop app (which copies, whatever its window offers), and when the sheet
// fails to open, the address is copied instead and the entry says so in place: the menu stays
// open, so the confirmation is read where the click was. The share call is made in the click
// handler itself, since browsers require a user gesture for it. The clipboard is written on a
// click only, never read, and the page sends nothing anywhere.
import { useState } from 'react';
import { SITE_NAME, SITE_URL } from '@/components/site';
import { IS_DESKTOP } from './shell';

/** the entry's label: it names the site, since a bare "Share" beside a scan could be read as sharing the scan */
export const SHARE_LABEL = `Share ${SITE_NAME}`;
/** the address as a reader would type it */
const SITE_HOST = SITE_URL.replace(/^https:\/\//, '');

export default function ShareMenuItem({ onShared }: { onShared: () => void }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SITE_URL);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  const onClick = () => {
    if (IS_DESKTOP || typeof navigator.share !== 'function') {
      void copy();
      return;
    }
    navigator.share({ title: SITE_NAME, url: SITE_URL }).then(onShared, (err: unknown) => {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      void copy();
    });
  };
  return (
    <button
      className="menu-item"
      role="menuitem"
      data-testid="share-site"
      title={`share this website's address, ${SITE_HOST}, or copy it; the scan on screen is never shared`}
      onClick={onClick}
    >
      <span aria-live="polite">
        {state === 'idle' ? SHARE_LABEL : state === 'copied' ? `Link copied: ${SITE_HOST}` : `Could not copy. The address is ${SITE_HOST}`}
      </span>
    </button>
  );
}
