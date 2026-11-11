// The viewer's single-letter keys (N, P, R, C, O, W, V, the number keys, Delete) answer only
// when no Cmd, Ctrl or Alt is held. A chord belongs to the browser or the desktop app's menu:
// Cmd-O opens, Cmd-W closes, Cmd-R reloads, Cmd-C copies, Cmd and a number switch tabs.

/** true when Cmd (Meta), Ctrl or Alt is held: leave the key to the browser or the app menu */
export function isChord(e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  return e.metaKey || e.ctrlKey || e.altKey;
}
