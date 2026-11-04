// The only off-origin addresses the page may ever request (docs/web-build.md, section 10,
// item 3), in one place: the three cloud providers' API bases and the three local presets.
// tests/noAbsoluteUrls.test.ts allows these literals in this file and nowhere else, and
// components/webCsp.mjs lists the same hosts in connect-src. Nothing here is contacted until
// the clinician switches the agent on.
//
// Sources, read 04/11/26: Anthropic Messages API (platform.claude.com docs, the claude-api
// reference); OpenAI Responses API (developers.openai.com API reference); Gemini
// generateContent (ai.google.dev Gemini API docs); llama-server README, Ollama
// OpenAI-compatibility docs, LM Studio docs for the local presets.

export const ANTHROPIC_BASE = 'https://api.anthropic.com';
export const OPENAI_BASE = 'https://api.openai.com';
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

export interface LocalPreset {
  id: 'llama-server' | 'ollama' | 'lm-studio';
  label: string;
  endpoint: string;
  /** the model id to start from; the clinician may type another */
  model: string;
}

export const LOCAL_PRESETS: LocalPreset[] = [
  { id: 'llama-server', label: 'llama-server', endpoint: 'http://127.0.0.1:8080', model: '' },
  { id: 'ollama', label: 'Ollama', endpoint: 'http://127.0.0.1:11434', model: 'qwen3-vl:8b' },
  { id: 'lm-studio', label: 'LM Studio', endpoint: 'http://127.0.0.1:1234', model: '' },
];

/** a local endpoint the policy allows: plain http on a loopback host, any port */
export function isLoopbackEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}
