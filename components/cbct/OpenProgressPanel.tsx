'use client';
// The open's progress panel (web build): from the moment files are handed over until the
// volume is on screen, inside the viewer area at full contrast (hard rule 4), never a toast.
// Three phases with elapsed seconds; a clear end state when nothing opens.
import { useEffect, useState } from 'react';
import type { OpenProgress } from '@/lib/browser/volumeSource';
import { IS_DESKTOP } from './shell';

export type OpenPanelState =
  | ({ kind: 'busy'; startedAt: number } & OpenProgress)
  | { kind: 'none'; error: string; reasons: string[]; /** plain words and an action, line 1 */ headline?: string };

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
  borderRadius: 'var(--ctl-radius)',
};

const card: React.CSSProperties = {
  minWidth: 'min(360px, 100%)',
  maxWidth: 560,
  padding: '16px 20px',
  background: 'var(--panel)',
  border: '1px solid var(--ctl-border)',
  borderRadius: 'var(--ctl-radius)',
  color: 'var(--text)',
  fontSize: 'var(--fs-body)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

export default function OpenProgressPanel({
  state,
  onDismiss,
  onOpenAnother,
}: {
  state: OpenPanelState;
  onDismiss: () => void;
  /** the refusal's action: the folder picker again */
  onOpenAnother?: () => void;
}) {
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
          {/* line 1: what happened in plain words, and what to do; line 2 on: the technical reason */}
          <div style={{ fontWeight: 600 }}>
            {state.headline ?? 'No CBCT volume could be read. Export from your CBCT software as DICOM, with compression off.'}
          </div>
          <div style={{ fontSize: 13 }}>{state.error}</div>
          {state.reasons.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              {state.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="ctl" onClick={onDismiss}>
              Dismiss
            </button>
            {onOpenAnother && (
              <button className="ctl" onClick={onOpenAnother} style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--bg)', fontWeight: 600 }}>
                Open another folder
              </button>
            )}
          </div>
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
