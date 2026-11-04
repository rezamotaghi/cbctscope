// The four providers the clinician can choose, one thin adapter each.
import { anthropicAdapter, ANTHROPIC_DEFAULT_MODEL } from './anthropic';
import { geminiAdapter, GEMINI_DEFAULT_MODEL } from './gemini';
import { LOCAL_PRESETS } from './hosts';
import { localAdapter } from './local';
import { openaiAdapter, OPENAI_DEFAULT_MODEL } from './openai';
import type { Adapter, ProviderId } from './types';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  /** a cloud provider needs a key; a local endpoint takes one only if it asks for it */
  needsKey: boolean;
  adapter: Adapter;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'anthropic', label: 'Anthropic', defaultModel: ANTHROPIC_DEFAULT_MODEL, needsKey: true, adapter: anthropicAdapter },
  { id: 'openai', label: 'OpenAI', defaultModel: OPENAI_DEFAULT_MODEL, needsKey: true, adapter: openaiAdapter },
  { id: 'gemini', label: 'Google Gemini', defaultModel: GEMINI_DEFAULT_MODEL, needsKey: true, adapter: geminiAdapter },
  { id: 'local', label: 'Local or custom endpoint', defaultModel: LOCAL_PRESETS[0].model, needsKey: false, adapter: localAdapter },
];

export function provider(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
