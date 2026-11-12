'use client';
// "Cite this software" (the Help menu): the reference line and the BibTeX entry derived from
// CITATION.cff at build time, each with a copy button. Full contrast; the scrim behind it is
// the one dimming (hard rule 4). Escape or Close closes it; Tab stays inside.
import React, { useEffect, useRef } from 'react';
import type { Citation } from '@/components/citation';
import CitationBlock from '@/components/CitationBlock';
import { backdrop, card, dialogTitle } from './WebDialogs';
import { useFocusTrap } from './menus';

export default function CiteDialog({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useFocusTrap(ref);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div style={backdrop}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="cite-title" style={{ ...card, maxWidth: 600 }}>
        <h2 id="cite-title" style={dialogTitle}>
          Cite this software
        </h2>
        <p style={{ margin: '0 0 12px' }}>
          If you use CBCTScope in research, please cite it. The text comes from the repository&apos;s CITATION.cff file.
        </p>
        <CitationBlock citation={citation} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button ref={closeRef} className="ctl" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
