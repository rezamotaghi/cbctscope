// The agent's select_volume against the shell (useAgentBridge's selectVolume handler). The
// size notice can hold a volume until the reader confirms; the agent then gets an error, never
// "ok" with the previous volume's state, because the reader must confirm a large volume
// themselves (docs/web-build.md, section 6).

/** what switchVolume reports: 'held' when the size notice holds the volume back */
export type SwitchOutcome = 'held' | 'switched' | 'same';

export const HELD_BY_SIZE_NOTICE = 'held behind the size notice; the reader must confirm';

/** null on success, else the error the agent gets */
export function selectVolumeVerb(
  id: string,
  known: readonly { anon: string }[],
  switchVolume: (id: string) => SwitchOutcome,
): string | null {
  if (!known.some((v) => v.anon === id)) return `unknown volume id: ${id}`;
  return switchVolume(id) === 'held' ? HELD_BY_SIZE_NOTICE : null;
}
