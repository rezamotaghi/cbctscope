// The four providers the clinician can choose, as the panel shows them: id, label, default
// model, whether a key is needed, and the local presets. No adapter and no cloud address lives
// here: the adapters, their API bases and the key run inside the sandboxed agent frame
// (components/cbct/agent/frame/, docs/web-build.md section 2), so the viewer's own page keeps
// connect-src 'self'. The loopback presets are addresses the clinician sees and may edit; the
// page never requests them (tests/noAbsoluteUrls.test.ts allows them in this file only).
import type { ProviderId } from '@/lib/shared/agentSettings';

export type { ProviderId };

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';
export const OPENAI_DEFAULT_MODEL = 'gpt-6-astra';
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

export interface LocalPreset {
  id: 'llama-server' | 'ollama' | 'lm-studio';
  label: string;
  endpoint: string;
  /** the model id to start from; the clinician may type another */
  model: string;
}

// llama-server README, Ollama OpenAI-compatibility docs, LM Studio docs, read 04/11/26
export const LOCAL_PRESETS: LocalPreset[] = [
  { id: 'llama-server', label: 'llama-server', endpoint: 'http://127.0.0.1:8080', model: '' },
  { id: 'ollama', label: 'Ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen3-vl:8b' },
  { id: 'lm-studio', label: 'LM Studio', endpoint: 'http://127.0.0.1:1234', model: '' },
];

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  /** a cloud provider needs a key; a local endpoint takes one only if it asks for it */
  needsKey: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'anthropic', label: 'Anthropic', defaultModel: ANTHROPIC_DEFAULT_MODEL, needsKey: true },
  { id: 'openai', label: 'OpenAI', defaultModel: OPENAI_DEFAULT_MODEL, needsKey: true },
  { id: 'gemini', label: 'Google Gemini', defaultModel: GEMINI_DEFAULT_MODEL, needsKey: true },
  { id: 'local', label: 'Local or custom endpoint', defaultModel: LOCAL_PRESETS[0].model, needsKey: false },
];

export function provider(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/** a local endpoint the policy allows: plain http on a loopback host, any port */
export function isLoopbackEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}
