// The small piece of state the header toggle (AgentToggle) and the docked panel (AgentPanel)
// share: whether the panel is open, the status line while the agent is on, and the panel's
// Switch off. A module store, read with useSyncExternalStore; the key is not here.

export interface AgentUiState {
  open: boolean;
  /** "Agent: on, <provider>" while on, null while off */
  status: string | null;
}

let state: AgentUiState = { open: false, status: null };
const listeners = new Set<() => void>();
let switchOffHandler: (() => void) | null = null;

export const agentUi = {
  get: (): AgentUiState => state,
  /** the state the static export renders with: closed and off */
  server: (): AgentUiState => SERVER_STATE,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  set(patch: Partial<AgentUiState>): void {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  },
  toggle(): void {
    agentUi.set({ open: !state.open });
  },
  /** the panel registers its Switch off here so the header can offer it too */
  onSwitchOff(fn: (() => void) | null): void {
    switchOffHandler = fn;
  },
  switchOff(): void {
    switchOffHandler?.();
  },
};

const SERVER_STATE: AgentUiState = { open: false, status: null };
