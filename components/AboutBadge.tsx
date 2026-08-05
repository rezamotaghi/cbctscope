'use client';
// The about door: the header version chip opens a small credibility panel stating who
// built this and why it can be trusted. The version is read from package.json so it can
// never drift from the release (the manual drift test pins the same source).
import React, { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import pkg from '@/package.json';

export default function AboutBadge({ product }: { product: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="about this software"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-dim)',
          fontSize: 11,
          cursor: 'pointer',
          padding: '2px 4px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        v{pkg.version}
        <Info size={11} strokeWidth={2} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 6,
            zIndex: 40,
            width: 300,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: '12px 14px',
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>{product}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 8 }}>v{pkg.version}</div>
          <div style={{ fontStyle: 'italic', marginBottom: 8 }}>
            Radiology software by the people who sign the reports.
          </div>
          <div>Dr. Reza Motaghi</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>Oral &amp; Maxillofacial Radiologist</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 8 }}>
            Research software, not a medical device. AGPL-3.0.
          </div>
        </div>
      )}
    </div>
  );
}
