'use client';
// The about door: the header version button opens a small credibility panel stating who
// built this and why it can be trusted, with links to the About page and the source code. The version is read
// from package.json so it can never drift from the release (the manual drift test pins the
// same source). Escape, or a press outside it (the image included), closes it. In the desktop
// app it also links the website's update page with this version after the # sign, the same
// address as the app's Check for Updates item; the app hands the https link to the system browser.
import React, { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Info } from 'lucide-react';
import pkg from '@/package.json';
import { AUTHOR_URL, REPO_URL } from './links';
import { useDismiss, useKeepInViewport } from './cbct/menus';
import { IS_DESKTOP } from './cbct/shell';
import { updatePageUrl } from './updateCheck';

const noSubscribe = () => () => {};

/**
 * onOpenAbout: where the About page opens. Given (the local app and the desktop app), it opens
 * the page in the drawer beside the viewer; absent (the website), the link opens a new tab.
 */
export default function AboutBadge({ product, onOpenAbout }: { product: string; onOpenAbout?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  useKeepInViewport(open, panel);
  // the desktop app, read after hydration (the exported HTML is rendered without a navigator)
  const inShell = useSyncExternalStore(noSubscribe, () => IS_DESKTOP, () => false);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className="ctl"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        title="about this software"
        style={{ padding: '0 4px', height: 16 }}
      >
        v{pkg.version}
        <Info size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div ref={panel} className="menu-panel" role="dialog" aria-label={`About ${product}`} style={{ left: 0, width: 300, padding: '12px 16px', lineHeight: 1.6 }}>
          <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600 }}>{product}</div>
          <div className="note" style={{ marginBottom: 8 }}>
            v{pkg.version}
          </div>
          <div style={{ fontStyle: 'italic', marginBottom: 8 }}>Radiology software by the people who sign the reports.</div>
          <div>
            <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', textDecoration: 'underline' }}>
              Dr. Reza Motaghi
            </a>
          </div>
          <div className="note">Oral &amp; Maxillofacial Radiologist</div>
          <div className="note" style={{ marginTop: 8 }}>
            Research software, not a medical device. AGPL-3.0.
          </div>
          <div style={{ marginTop: 8 }}>
            {onOpenAbout ? (
              <button
                type="button"
                className="ctl"
                onClick={() => {
                  setOpen(false);
                  onOpenAbout();
                }}
              >
                About CBCTScope and how to cite it
              </button>
            ) : (
              <a href="about" target="_blank" rel="noopener" style={{ color: 'var(--text)' }} onClick={() => setOpen(false)}>
                About CBCTScope and how to cite it
              </a>
            )}
          </div>
          <div style={{ marginTop: 4 }}>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)' }}>
              Source code repository
            </a>
          </div>
          {inShell && (
            <div style={{ marginTop: 4 }}>
              <a
                href={updatePageUrl(pkg.version)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text)' }}
                title="opens the website's update page in your browser; this version travels after the # sign, which is not sent to any server"
                onClick={() => setOpen(false)}
              >
                Check for updates
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
