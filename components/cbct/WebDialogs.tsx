'use client';
// The web build's two dialogues (docs/web-build.md, section 6). Plain React, full contrast:
// the scrim behind an open dialogue is the one dimming anywhere (hard rule 4), and it darkens
// the viewer behind, never the dialogue's own text or buttons. Tab stays inside the dialogue.
import React, { useRef } from 'react';
import { formatBytes } from './sizeNotice';
import { IS_DESKTOP } from './shell';
import { useFocusTrap } from './menus';

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

export const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

export const card: React.CSSProperties = {
  maxWidth: 460,
  width: '100%',
  background: 'var(--panel)',
  color: 'var(--text)',
  border: '1px solid var(--ctl-border)',
  borderRadius: 'var(--ctl-radius)',
  boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
  padding: '16px 20px',
  fontSize: 'var(--fs-body)',
  lineHeight: 1.6,
};

export const dialogTitle: React.CSSProperties = { fontSize: 'var(--fs-title)', fontWeight: 600, margin: '0 0 8px' };

/** a dialogue's one primary button, right-most, takes the accent; every other button is plain */
export const dialogButton = (primary: boolean): React.CSSProperties =>
  primary ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--bg)', fontWeight: 600 } : {};

/** the dialogue frame: the scrim, the card, and Tab kept inside */
export function Dialog({ labelledBy, children }: { labelledBy: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref);
  return (
    <div style={backdrop}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} style={card}>
        {children}
      </div>
    </div>
  );
}

export function ResearchUseDialog({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <Dialog labelledBy="research-use-title">
        <h2 id="research-use-title" style={dialogTitle}>
          Research use only
        </h2>
        <p style={{ margin: '0 0 8px' }}>CBCTScope is research software. It is not a medical device.</p>
        <p style={{ margin: '0 0 8px' }}>
          The agent moves the camera; the human reads. CBCTScope never produces findings or a diagnosis.
        </p>
        <p style={{ margin: '0 0 16px' }}>
          {IS_DESKTOP
            ? "Nothing leaves this computer, except the agent's snapshots of the view, which go to the model you chose once you switch the agent on. The scan is read from your disk into this app."
            : "Nothing of your scan leaves this tab, except the agent's snapshots of the view, which go to the model you chose once you switch the agent on. The scan is read from your disk into this tab and is not uploaded anywhere."}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="ctl" style={dialogButton(true)} onClick={onAcknowledge} autoFocus>
            I understand
          </button>
        </div>
    </Dialog>
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
    <Dialog labelledBy="size-notice-title">
        <h2 id="size-notice-title" style={dialogTitle}>
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
        <p style={{ margin: '0 0 16px' }}>The viewer run from the repository holds the whole volume in a browser tab as well; it only shows no notice.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="ctl" onClick={onCancel}>
            Cancel
          </button>
          <button className="ctl" style={dialogButton(true)} onClick={onContinue} autoFocus>
            Continue
          </button>
        </div>
    </Dialog>
  );
}
