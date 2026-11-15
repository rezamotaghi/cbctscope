'use client';
// The citation, shown twice: the plain reference line and the BibTeX entry, each with a copy
// button (the About page, and the viewer's Cite dialogue). Both come from CITATION.cff
// (components/citation.ts). The clipboard is written on a click only, never read.
import React, { useState } from 'react';
import type { Citation } from './citation';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button type="button" className="ctl" onClick={() => void copy()}>
        {label}
      </button>
      <span role="status" className="note">
        {state === 'copied' ? 'Copied.' : state === 'failed' ? 'The browser did not allow copying: select the text and copy it.' : ''}
      </span>
    </span>
  );
}

export default function CitationBlock({ citation }: { citation: Citation }) {
  const [before] = citation.reference.split(citation.doiUrl);
  return (
    <div>
      <h3 style={{ fontSize: 'var(--fs-body)', margin: '0 0 4px' }}>Reference</h3>
      <p className="cite-ref" data-testid="cite-reference">
        {before}
        <a href={citation.doiUrl} target="_blank" rel="noopener noreferrer">
          {citation.doiUrl}
        </a>
      </p>
      <CopyButton text={citation.reference} label="Copy reference" />
      <h3 style={{ fontSize: 'var(--fs-body)', margin: '16px 0 4px' }}>BibTeX</h3>
      <pre className="cite-pre" data-testid="cite-bibtex">
        {citation.bibtex}
      </pre>
      <CopyButton text={citation.bibtex} label="Copy BibTeX" />
    </div>
  );
}
