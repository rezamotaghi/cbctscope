'use client';
// The about door: the header version button opens a small credibility panel stating who
// built this and why it can be trusted, with the link to the source code. The version is read
// from package.json so it can never drift from the release (the manual drift test pins the
// same source). Escape, or a press outside it (the image included), closes it.
import React, { useCallback, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import pkg from '@/package.json';
import { REPO_URL } from './links';
import { useDismiss, useKeepInViewport } from './cbct/menus';

export default function AboutBadge({ product }: { product: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  useKeepInViewport(open, panel);

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
          <div style={{ color: 'var(--text-dim)', marginBottom: 8 }}>v{pkg.version}</div>
          <div style={{ fontStyle: 'italic', marginBottom: 8 }}>Radiology software by the people who sign the reports.</div>
          <div>Dr. Reza Motaghi</div>
          <div style={{ color: 'var(--text-dim)' }}>Oral &amp; Maxillofacial Radiologist</div>
          <div style={{ color: 'var(--text-dim)', marginTop: 8 }}>Research software, not a medical device. AGPL-3.0.</div>
          <div style={{ marginTop: 8 }}>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)' }}>
              Source code repository
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
