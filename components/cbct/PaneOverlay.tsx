'use client';
// The pieces every image pane draws its overlay with (the grammar is in ./overlayGrammar.ts):
// the plane and slice label top left, the window readout bottom right, the corner buttons,
// and the 1 px accent frame on the pane that takes the wheel. Every overlay box carries
// data-overlay, so the end-to-end suite can check that no two of them touch.
import React, { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { OVERLAY_HALO, wlText } from './overlayGrammar';
import type { PaneButtonSpec } from './paneButtons';

/** overlay text: 12 px, tabular figures, primary text colour on a dark halo, never in the way of the pointer */
export const overlayText: React.CSSProperties = {
  position: 'absolute',
  fontSize: 'var(--fs-meta)',
  lineHeight: '16px',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--text)',
  textShadow: OVERLAY_HALO,
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  zIndex: 1,
};

/** the plane name (in its colour, when it has one) and the slice n/N, top left */
export function PaneLabel({
  name,
  color,
  slice,
  style,
}: {
  name: string;
  color?: string;
  slice?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span data-overlay="label" style={{ ...overlayText, top: 4, left: 8, ...style }}>
      <span style={{ color: color ?? 'var(--text)', fontWeight: 600 }}>{name}</span>
      {slice ? ` ${slice}` : ''}
    </span>
  );
}

/** the window the pane shows, bottom right: "W 4000 L 1000" */
export function WlReadout({ voi, style }: { voi: { center: number; width: number } | null | undefined; style?: React.CSSProperties }) {
  if (!voi) return null;
  return (
    <span data-overlay="wl" data-testid="pane-wl" style={{ ...overlayText, bottom: 4, right: 8, ...style }}>
      {wlText(voi)}
    </span>
  );
}

const paneButtonBase: React.CSSProperties = {
  height: 'var(--ctl-h-pane)',
  minWidth: 'var(--ctl-h-pane)',
  padding: 0,
  borderRadius: 'var(--ctl-radius)',
  border: '1px solid var(--ctl-border)',
  background: 'rgba(20,23,29,0.92)',
  color: 'var(--text)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  fontSize: 'var(--fs-meta)',
  lineHeight: 1,
};

/** a pane-corner button: the icon alone, its name as the aria-label and the tooltip's first words */
export function PaneButton({
  spec,
  detail,
  active = false,
  ...rest
}: { spec: PaneButtonSpec; detail?: string; active?: boolean } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  const Icon = spec.icon;
  return (
    <button
      type="button"
      aria-label={spec.name}
      title={detail ? `${spec.name}: ${detail}` : spec.name}
      onDoubleClick={(e) => e.stopPropagation()}
      {...rest}
      style={{ ...paneButtonBase, ...(active ? { background: 'var(--accent)', color: '#0c0e12' } : {}), ...rest.style }}
    >
      <Icon size={14} strokeWidth={2} aria-hidden />
    </button>
  );
}

/** a pane button that needs its word (Save view, Eraser, Revert): icon beside the label */
export function PaneTextButton({
  icon: Icon,
  label,
  active = false,
  children,
  ...rest
}: { icon?: LucideIcon; label: string; active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onDoubleClick={(e) => e.stopPropagation()}
      {...rest}
      style={{
        ...paneButtonBase,
        padding: '0 8px',
        ...(active ? { background: 'var(--accent)', color: '#0c0e12' } : {}),
        ...rest.style,
      }}
    >
      {Icon && <Icon size={14} strokeWidth={2} aria-hidden />}
      {label}
      {children}
    </button>
  );
}

/** the top-right button cluster of a pane */
export function PaneCluster({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      data-overlay="buttons"
      onDoubleClick={(e) => e.stopPropagation()}
      style={{ position: 'absolute', top: 4, right: 8, display: 'flex', gap: 4, alignItems: 'center', zIndex: 2, ...style }}
    >
      {children}
    </div>
  );
}

/**
 * Which pane takes the wheel: the one the pointer last entered, pressed or scrolled in. It
 * stays marked after the pointer leaves the panes, so the frame always names one pane.
 */
export function useActivePane<T extends string>(initial: T) {
  const [active, setActive] = useState<T>(initial);
  const bind = (id: T) => ({
    'data-pane': id,
    'data-active-pane': active === id ? 'true' : 'false',
    onPointerEnter: () => setActive(id),
    onPointerDown: () => setActive(id),
    onWheelCapture: () => setActive(id),
  });
  return { active, setActive, bind };
}

/** the 1 px accent frame on the active pane (drawn over the image, never catching the pointer) */
export function ActiveFrame({ on }: { on: boolean }) {
  return (
    <div
      aria-hidden
      data-active-frame={on ? 'true' : 'false'}
      style={{
        position: 'absolute',
        inset: 0,
        border: `1px solid ${on ? 'var(--accent)' : 'transparent'}`,
        borderRadius: 4,
        pointerEvents: 'none',
        zIndex: 3,
      }}
    />
  );
}

/** the scale bar, bottom centre: a yellow bar of a round length with its label */
export function ScaleBar({ px, label, bottom = 22 }: { px: number; label: string; bottom?: number }) {
  return (
    <span
      data-overlay="scale"
      data-testid="pane-scale"
      style={{ ...overlayText, bottom, left: '50%', transform: 'translateX(-50%)', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--mark)' }}
    >
      <span
        style={{
          display: 'inline-block',
          width: Math.round(px),
          height: 6,
          borderLeft: '2px solid var(--mark)',
          borderRight: '2px solid var(--mark)',
          borderBottom: '2px solid var(--mark)',
          boxShadow: '0 1px 2px #000',
        }}
      />
      {label}
    </span>
  );
}
