// The in-page agent's remembered choices: provider, local endpoint and model id. None is a
// secret, so they may stay in localStorage between visits; the key never does (it lives in
// components/cbct/agent/keyStore.ts, memory only). This file is the agent's only storage
// access, kept outside components/cbct/agent/ so the scan there can stay absolute.
// saveAgentSettings writes the three named fields and nothing else.

/** the four providers (components/cbct/agent/providers/index.ts) */
export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'local';

export const AGENT_SETTINGS_KEY = 'cbctscope-agent-settings-v1';

export interface AgentSettings {
  provider: ProviderId;
  endpoint: string;
  model: string;
}

const PROVIDER_IDS: ProviderId[] = ['anthropic', 'openai', 'gemini', 'local'];

export function loadAgentSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Partial<AgentSettings> {
  try {
    const raw = storage?.getItem(AGENT_SETTINGS_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<AgentSettings> = {};
    if (PROVIDER_IDS.includes(v.provider as ProviderId)) out.provider = v.provider as ProviderId;
    if (typeof v.endpoint === 'string') out.endpoint = v.endpoint;
    if (typeof v.model === 'string') out.model = v.model;
    return out;
  } catch {
    return {};
  }
}

export function saveAgentSettings(s: AgentSettings, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    const { provider, endpoint, model } = s;
    storage?.setItem(AGENT_SETTINGS_KEY, JSON.stringify({ provider, endpoint, model }));
  } catch {
    /* storage blocked: the choices are simply asked again next time */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
