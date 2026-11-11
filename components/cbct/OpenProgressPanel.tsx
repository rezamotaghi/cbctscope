'use client';
// The open's progress panel (web build): from the moment files are handed over until the
// volume is on screen, inside the viewer area at full contrast (hard rule 4), never a toast.
// Three phases with elapsed seconds; a clear end state when nothing opens.
import { useEffect, useState } from 'react';
import type { OpenProgress } from '@/lib/browser/volumeSource';
import { IS_DESKTOP } from './shell';

export type OpenPanelState =
  | ({ kind: 'busy'; startedAt: number } & OpenProgress)
  | { kind: 'none'; error: string; reasons: string[] };

const fmt = (n: number) => n.toLocaleString('en-US');

/** the panel's phase line */
export function openProgressText(p: OpenProgress): string {
  if (p.phase === 'scan') {
    return p.total === undefined
      ? 'Reading headers: listing the files'
      : `Reading headers: ${fmt(p.done)} of ${fmt(p.total)} files`;
  }
  if (p.phase === 'assemble') return `Assembling the volume: ${Math.round(p.done)} %`;
  return 'Preparing the display';
}

/** 0..1 for the bar; the display phase has no count, so its bar stays full */
function fractionOf(p: OpenProgress): number {
  if (p.phase === 'display') return 1;
  if (!p.total) return 0;
  return Math.min(1, p.done / p.total);
}

const box: React.CSSProperties = {
  position: 'absolute',
  inset: 8,
  zIndex: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg)',
  borderRadius: 8,
};

const card: React.CSSProperties = {
  minWidth: 360,
  maxWidth: 560,
  padding: '18px 22px',
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

export default function OpenProgressPanel({ state, onDismiss }: { state: OpenPanelState; onDismiss: () => void }) {
  const busy = state.kind === 'busy';
  const startedAt = busy ? state.startedAt : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [busy, startedAt]);

  if (state.kind === 'none') {
    return (
      <div style={box}>
        <div data-testid="open-none" role="alert" style={card}>
          <div style={{ fontWeight: 600 }}>{state.error}</div>
          {state.reasons.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {state.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <div>
            Open a DICOMDIR, a DICOM folder or a single DICOM file. Only uncompressed DICOM opens.
          </div>
          <button
            onClick={onDismiss}
            style={{
              alignSelf: 'flex-start',
              padding: '4px 12px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--panel-2)',
              color: 'var(--text)',
              fontSize: 13,
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  const elapsed = Math.max(0, Math.floor((now - state.startedAt) / 1000));
  const pct = Math.round(fractionOf(state) * 100);
  const step = state.phase === 'scan' ? 1 : state.phase === 'assemble' ? 2 : 3;
  return (
    <div style={box}>
      <div data-testid="open-progress" role="status" aria-live="polite" style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ fontWeight: 600 }}>{openProgressText(state)}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{elapsed} s</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          style={{ height: 8, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4 }}
        >
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 4 }} />
        </div>
        <div style={{ fontSize: 13 }}>
          Step {step} of 3.{' '}
          {IS_DESKTOP
            ? 'The files are read in this app on this computer; nothing is uploaded.'
            : 'The files are read in this tab; nothing is uploaded.'}
        </div>
      </div>
    </div>
  );
}
