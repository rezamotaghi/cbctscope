'use client';
// ONE snapshot door for every room: the same button, the same icon, the same
// "what this room shows right now → one PNG" contract, living in the shell header so it
// sits in the same place no matter which mode is open. Rooms with a richer bespoke
// composer keep their behavior behind this shared face; rooms without one use the
// generic canvas compositor below.
import React from 'react';
import { Camera } from 'lucide-react';

/** The active room registers its composer here; the ONE header snapshot button calls it. */
export type SnapRef = React.MutableRefObject<(() => void) | null>;

export default function SnapshotButton({
  onClick,
  title,
  label = 'snapshot',
  disabled = false,
  floating = false,
}: {
  onClick: () => void;
  title?: string;
  label?: string;
  disabled?: boolean;
  /** translucent-dark toolbar look instead of the chip look */
  floating?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? 'snapshot: save what this room shows (as laid out on screen) as a PNG image'}
      style={{
        padding: floating ? '0 10px' : '4px 10px',
        height: floating ? 24 : undefined,
        borderRadius: floating ? 5 : 6,
        border: '1px solid var(--border)',
        background: floating ? 'rgba(27,31,39,0.9)' : 'var(--panel-2)',
        color: 'var(--text)',
        fontSize: floating ? 11 : 12,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
      }}
    >
      <Camera size={13} strokeWidth={2} />
      {label}
    </button>
  );
}

/** Generic room snapshot: draw every visible canvas inside `root` at its on-screen
 *  position (object-fit: contain respected) onto one dark PNG with a case·room·date
 *  footer, and download it. Rooms whose panes are plain canvases get a faithful
 *  what-you-see capture with zero per-room composition code. Returns false when there
 *  is nothing to capture (no volume yet). */
export async function snapshotPaneCanvases(
  root: HTMLElement | null,
  footer: string,
  filename: string,
): Promise<boolean> {
  if (!root) return false;
  // two rAFs: whatever state change preceded the click has painted
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const rootR = root.getBoundingClientRect();
  if (rootR.width < 2 || rootR.height < 2) return false;
  const canvases = Array.from(root.querySelectorAll('canvas')).filter((c) => {
    const r = c.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && c.width > 0 && c.height > 0;
  });
  if (canvases.length === 0) return false;

  const scale = 2; // crisp on retina; the sources are already device-resolution canvases
  const FOOT = 22;
  const out = document.createElement('canvas');
  out.width = Math.round(rootR.width * scale);
  out.height = Math.round(rootR.height * scale) + FOOT * scale;
  const ctx = out.getContext('2d');
  if (!ctx) return false;
  ctx.fillStyle = '#0b0d11';
  ctx.fillRect(0, 0, out.width, out.height);

  for (const c of canvases) {
    const r = c.getBoundingClientRect();
    // object-fit: contain mapping — the backing store letterboxes inside the CSS box
    const s = Math.min(r.width / c.width, r.height / c.height);
    const dw = c.width * s * scale;
    const dh = c.height * s * scale;
    const dx = (r.left - rootR.left + (r.width - c.width * s) / 2) * scale;
    const dy = (r.top - rootR.top + (r.height - c.height * s) / 2) * scale;
    try {
      ctx.drawImage(c, dx, dy, dw, dh);
    } catch {
      /* a mid-teardown canvas draws nothing — skip it */
    }
  }

  ctx.fillStyle = '#aeb6c6';
  ctx.font = `${12 * scale}px system-ui, sans-serif`;
  ctx.textBaseline = 'bottom';
  ctx.fillText(footer, 6 * scale, out.height - 5 * scale);

  const a = document.createElement('a');
  a.href = out.toDataURL('image/png');
  a.download = filename;
  a.click();
  return true;
}
