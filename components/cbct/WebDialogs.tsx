'use client';
// The web build's two dialogues (docs/web-build.md, section 6). Plain React, full contrast,
// nothing dimmed or hidden (hard rule 4): the backdrop darkens the viewer behind the dialogue,
// never the dialogue's own text or buttons.
import React from 'react';
import { formatBytes } from './sizeNotice';
import { IS_DESKTOP } from './shell';

/** localStorage key: the reader acknowledged the research-use dialogue in this browser profile */
export const RESEARCH_ACK_KEY = 'cbctscope-research-ack-v1';

export function researchAcknowledged(): boolean {
  try {
    return localStorage.getItem(RESEARCH_ACK_KEY) === '1';
  } catch {
    return false; // storage blocked: ask again, never assume
  }
}

export function acknowledgeResearch(): void {
  try {
    localStorage.setItem(RESEARCH_ACK_KEY, '1');
  } catch {
    /* storage blocked: the dialogue simply returns next time */
  }
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const card: React.CSSProperties = {
  maxWidth: 460,
  width: '100%',
  background: 'var(--panel)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
  padding: '18px 20px',
  fontSize: 13,
  lineHeight: 1.6,
};

const button = (primary: boolean): React.CSSProperties => ({
  padding: '6px 14px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: primary ? 'var(--accent-dim)' : 'var(--panel-2)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: primary ? 600 : 400,
});

export function ResearchUseDialog({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <div style={backdrop}>
      <div role="dialog" aria-modal="true" aria-labelledby="research-use-title" style={card}>
        <h2 id="research-use-title" style={{ fontSize: 16, margin: '0 0 10px' }}>
          Research use only
        </h2>
        <p style={{ margin: '0 0 8px' }}>CBCTScope is research software. It is not a medical device.</p>
        <p style={{ margin: '0 0 8px' }}>
          The agent moves the camera; the human reads. CBCTScope never produces findings or a diagnosis.
        </p>
        <p style={{ margin: '0 0 14px' }}>
          {IS_DESKTOP
            ? "Nothing leaves this computer, except the agent's snapshots of the view, which go to the model you chose once you switch the agent on. The scan is read from your disk into this app."
            : "Nothing leaves this tab, except the agent's snapshots of the view, which go to the model you chose once you switch the agent on. The scan is read from your disk into this tab and is not uploaded anywhere."}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button style={button(true)} onClick={onAcknowledge} autoFocus>
            I understand
          </button>
        </div>
      </div>
    </div>
  );
}

export function SizeNoticeDialog({
  label,
  bytes,
  onContinue,
  onCancel,
}: {
  label: string;
  bytes: number;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={backdrop}>
      <div role="dialog" aria-modal="true" aria-labelledby="size-notice-title" style={card}>
        <h2 id="size-notice-title" style={{ fontSize: 16, margin: '0 0 10px' }}>
          Large volume
        </h2>
        <p style={{ margin: '0 0 8px' }}>
          {label} holds {formatBytes(bytes)} of voxels.
        </p>
        <p style={{ margin: '0 0 8px' }}>
          {IS_DESKTOP
            ? 'This app must hold the whole volume in memory. On a computer with little free memory it may slow down or stop.'
            : 'The browser must hold the whole volume in memory. On a computer with little free memory the tab may slow down or stop.'}
        </p>
        <p style={{ margin: '0 0 14px' }}>The viewer run from the repository holds the whole volume in a browser tab as well; it only shows no notice.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={button(false)} onClick={onCancel}>
            Cancel
          </button>
          <button style={button(true)} onClick={onContinue} autoFocus>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
