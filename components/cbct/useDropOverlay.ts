'use client';
// The drop overlay's visibility (docs/web-build.md, section 7). Browsers fire dragenter and
// dragleave for every child the pointer crosses, so a leave on a child must not clear the
// overlay and a leave on the root alone is not reliable either. A depth counter on the viewer
// root tracks enters minus leaves; the overlay shows while it is above zero, and clears on
// drop, dragend, Escape, and when the pointer leaves the window.
import { useCallback, useEffect, useRef, useState } from 'react';

/** enters minus leaves; pure, so the rule is unit-tested */
export function dragDepth() {
  let depth = 0;
  return {
    enter: () => ++depth > 0,
    leave: () => (depth = Math.max(0, depth - 1)) > 0,
    reset: () => {
      depth = 0;
      return false;
    },
  };
}

const hasFiles = (e: { dataTransfer: DataTransfer | null }) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

export function useDropOverlay(enabled: boolean, onDrop: (dt: DataTransfer) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(dragDepth());

  useEffect(() => {
    if (!enabled) return;
    const clear = () => setOver(depth.current.reset());
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && clear();
    // the pointer left the window: a dragleave with no element it went to
    const onWindowLeave = (e: DragEvent) => {
      if (!e.relatedTarget) clear();
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    window.addEventListener('keydown', onKey);
    document.addEventListener('dragleave', onWindowLeave);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('dragleave', onWindowLeave);
    };
  }, [enabled]);

  const handlers = {
    onDragEnter: useCallback((e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setOver(depth.current.enter());
    }, []),
    onDragOver: useCallback((e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }, []),
    onDragLeave: useCallback((e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      setOver(depth.current.leave());
    }, []),
    onDrop: useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        setOver(depth.current.reset());
        onDrop(e.dataTransfer);
      },
      [onDrop],
    ),
  };
  return { over, handlers };
}
