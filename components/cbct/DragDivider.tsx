'use client';
// Shared drag-handle for pane divider lines (MPR quadrant lines, Grid scout|stack line, …).
// Drag mechanics: pointer capture + touch-action:none (a custom drag surface must own the
// gesture), the active flag in a ref so the first pointermove after pointerdown can't be
// dropped by a stale state closure. Hosts own the geometry — this component only turns a
// drag into onMove(clientX, clientY) calls and paints itself accent while active. Always
// visible at rest (medical-dashboard rule: never hide a control). Double-click = onReset
// (back to the default split).
import React, { useRef, useState } from 'react';

interface Props {
  cursor: 'col-resize' | 'row-resize' | 'move';
  title: string;
  style: React.CSSProperties;
  onMove: (clientX: number, clientY: number) => void;
  /** Release — persist the final split here. */
  onEnd?: () => void;
  onReset?: () => void;
}

export default function DragDivider({ cursor, title, style, onMove, onEnd, onReset }: Props) {
  const on = useRef(false);
  const [active, setActive] = useState(false);
  const end = () => {
    if (!on.current) return;
    on.current = false;
    setActive(false);
    onEnd?.();
  };
  return (
    <div
      title={title}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointer */
        }
        on.current = true;
        setActive(true);
      }}
      onPointerMove={(e) => {
        if (on.current) onMove(e.clientX, e.clientY);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      style={{
        touchAction: 'none',
        cursor,
        background: active ? 'var(--accent)' : 'var(--panel-2)',
        ...style,
      }}
    />
  );
}
