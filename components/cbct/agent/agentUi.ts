// The in-page agent's session, a module store read with useSyncExternalStore by the header
// (AgentToggle: the Agent button, which reads "Agent on" while the agent is on, and Stop while
// a request runs) and the docked panel (AgentPanel, with the status and Switch off). The
// session outlives the panel: closing the panel unmounts it, and the request in flight keeps
// its Stop in the header (hard rule 4: an active control is never hidden). The provider key is not here: the panel posts it to the agent frame once
// (agentFrame.ts) and the frame alone holds it.
//
// Model prose is kept apart from the log: it is shown only in the panel's labelled block
// ("Model text. Not a reading, not a finding."), after the reading-term guard
// (lib/shared/readingTerms.mjs) has replaced any text that carries report vocabulary.
import { guardModelText } from '@/lib/shared/readingTerms.mjs';
import { pageTransport } from '../agentTransport';
import { createAgentFrame, FrameStopped, type AgentFrame } from './agentFrame';
import { provider as providerOf, type ProviderId } from './catalog';
import type { AgentEvent } from './frame/protocol';
import { MAX_TOOL_CALLS, SYSTEM_PROMPT } from './prompt';
import { executeTool, PAGE_TOOLS } from './tools';

export type Phase = 'off' | 'setup' | 'confirm' | 'starting' | 'on';

export interface LogLine {
  who: 'you' | 'tool' | 'error' | 'note';
  text: string;
}

export interface ModelLine {
  text: string;
  /** the guard replaced the model's words */
  replaced: boolean;
}

export interface AgentUiState {
  open: boolean;
  phase: Phase;
  /** "Agent: on, <provider>" while on, null otherwise */
  status: string | null;
  /** the provider as the status names it */
  providerName: string;
  busy: boolean;
  log: LogLine[];
  modelText: ModelLine[];
}

const OFF: AgentUiState = { open: false, phase: 'off', status: null, providerName: '', busy: false, log: [], modelText: [] };

let state: AgentUiState = OFF;
const listeners = new Set<() => void>();
let frame: AgentFrame | null = null;
let inflight: AbortController | null = null;

function set(patch: Partial<AgentUiState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

const addLog = (line: LogLine) => set({ log: [...state.log, line] });

const fmtArgs = (a: Record<string, unknown>) => (Object.keys(a).length ? ` ${JSON.stringify(a)}` : '');

export const agentUi = {
  get: (): AgentUiState => state,
  /** the state the static export renders with: closed and off */
  server: (): AgentUiState => OFF,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setOpen(open: boolean): void {
    set({ open });
  },
  toggle(): void {
    set({ open: !state.open });
  },
  setPhase(phase: 'off' | 'setup' | 'confirm'): void {
    if (state.phase === 'on' || state.phase === 'starting') return;
    set({ phase });
  },

  /** the clinician confirmed the opt-in dialogue: start the frame and hand it the key once */
  async switchOn(o: { provider: ProviderId; model: string; endpoint: string; key: string }): Promise<void> {
    agentUi.switchOff();
    const info = providerOf(o.provider);
    const providerName = o.provider === 'local' ? `${info.label} (${o.endpoint})` : info.label;
    set({ phase: 'starting', providerName, log: [], modelText: [] });
    const f = createAgentFrame({ provider: o.provider, model: o.model, endpoint: o.endpoint, key: o.key, system: SYSTEM_PROMPT, tools: PAGE_TOOLS });
    frame = f;
    try {
      await f.ready;
    } catch (err) {
      if (frame !== f) return;
      f.destroy();
      frame = null;
      set({ phase: 'setup', log: [{ who: 'error', text: err instanceof Error ? err.message : String(err) }] });
      return;
    }
    if (frame !== f) return;
    set({
      phase: 'on',
      status: `Agent: on, ${providerName}`,
      log: [{ who: 'note', text: `Ask for a view, for example: "show the left TMJ in sagittal, bone window". At most ${MAX_TOOL_CALLS} steps per request.` }],
    });
  },

  /** stop everything, forget the key (the frame and its memory are removed) */
  switchOff(): void {
    inflight?.abort();
    inflight = null;
    frame?.destroy();
    frame = null;
    set({ ...OFF, open: state.open });
  },

  /** the request in flight stops; the agent stays on */
  stop(): void {
    inflight?.abort();
  },

  async send(text: string): Promise<void> {
    const f = frame;
    if (!f || state.phase !== 'on' || state.busy || !text.trim()) return;
    addLog({ who: 'you', text });
    const ctrl = new AbortController();
    inflight = ctrl;
    set({ busy: true });
    const onEvent = (e: AgentEvent) => {
      if (ctrl.signal.aborted || frame !== f) return;
      if (e.kind === 'text') set({ modelText: [...state.modelText, guardModelText(e.text)] });
      else if (e.kind === 'call') {
        // a step's arguments are model text too (a view name): guarded the same way
        const shown = guardModelText(fmtArgs(e.args));
        addLog({ who: 'tool', text: shown.replaced ? `${e.name} (arguments withheld: ${shown.text})` : `${e.name}${shown.text}` });
      } else if (e.isError) addLog({ who: 'error', text: `${e.name}: ${e.text}` });
      else if (e.image) addLog({ who: 'note', text: `snapshot sent to ${state.providerName}` });
    };
    try {
      await f.run(text, onEvent, (name, args, signal) => executeTool(pageTransport, name, args, signal), ctrl.signal);
    } catch (err) {
      if (frame === f) {
        if (ctrl.signal.aborted || err instanceof FrameStopped) addLog({ who: 'note', text: 'Stopped.' });
        else addLog({ who: 'error', text: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      if (inflight === ctrl) {
        inflight = null;
        if (frame === f) set({ busy: false });
      }
    }
  },
};
