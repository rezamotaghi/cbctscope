// Every icon-only button in an image pane's corner, with the word it stands for. The panes
// draw them from here, and the Keys card and the manual (section 3.7, checked by
// tests/overlayGrammar.test.ts) list them from here, so an icon never means something only a
// hover could tell. Icons are the Lucide line set, 14 px, each with its standard meaning.
import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Redo2,
  RotateCcw,
  Undo2,
  type LucideIcon,
} from 'lucide-react';

export interface PaneButtonSpec {
  icon: LucideIcon;
  /** the button's name: its aria-label, its tooltip's first words, its line in Keys and the manual */
  name: string;
  /** what it does, one short sentence for the Keys card */
  what: string;
}

export const PANE_BUTTON = {
  reset: { icon: RotateCcw, name: 'Reset view', what: "Re-fit this pane's zoom and pan; on the 3D pane, re-home the camera." },
  flip: { icon: ArrowLeftRight, name: 'Flip', what: "Mirror this pane's viewing direction." },
  orbitLeft: { icon: ArrowLeft, name: 'Orbit left', what: 'Turn the 3D render left; hold to keep turning.' },
  orbitRight: { icon: ArrowRight, name: 'Orbit right', what: 'Turn the 3D render right; hold to keep turning.' },
  orbitUp: { icon: ArrowUp, name: 'Orbit up', what: 'Tip the 3D render up; hold to keep turning.' },
  orbitDown: { icon: ArrowDown, name: 'Orbit down', what: 'Tip the 3D render down; hold to keep turning.' },
  undoErase: { icon: Undo2, name: 'Undo erase', what: 'Undo the last render-eraser stroke.' },
  redoErase: { icon: Redo2, name: 'Redo erase', what: 'Redo the stroke just undone.' },
} as const satisfies Record<string, PaneButtonSpec>;

/** the list the Keys card renders: icon, name, what it does */
export const PANE_BUTTONS: readonly PaneButtonSpec[] = Object.values(PANE_BUTTON);
