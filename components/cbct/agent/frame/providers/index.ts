// The four adapters, by provider id. Frame code only (components/cbct/agent/frame/): the
// viewer's page never imports an adapter.
import { anthropicAdapter } from './anthropic';
import { geminiAdapter } from './gemini';
import { localAdapter } from './local';
import { openaiAdapter } from './openai';
import type { Adapter, ProviderId } from './types';

export const ADAPTERS: Record<ProviderId, Adapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
  local: localAdapter,
};
