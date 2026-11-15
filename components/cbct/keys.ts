// The viewer's single-letter keys (N, P, R, C, O, W, V, the number keys, Delete) answer only
// when no Cmd, Ctrl or Alt is held. A chord belongs to whatever hosts the page: in a browser,
// Cmd-O opens, Cmd-W closes the tab, Cmd-R reloads and Cmd and a number switch tabs; in the
// desktop app, its menu's Cmd-O opens, Cmd-W closes the window and Cmd-C copies, and there is
// no reload and no tab.

/** true when Cmd (Meta), Ctrl or Alt is held: leave the key to the browser or the app menu */
export function isChord(e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  return e.metaKey || e.ctrlKey || e.altKey;
}

/** true while a modal dialogue is open: the viewer's keys wait until it closes */
export function modalOpen(doc: Pick<Document, 'querySelector'> | null = typeof document !== 'undefined' ? document : null): boolean {
  return !!doc?.querySelector('[aria-modal="true"]');
}
