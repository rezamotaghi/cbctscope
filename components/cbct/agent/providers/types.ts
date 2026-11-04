// The provider-neutral conversation the loop keeps (components/cbct/agent/loop.ts), and the
// one call every adapter implements. Each adapter turns these turns into its own request
// shape and its reply back into text plus tool calls. The assistant turn keeps the
// provider's own reply (`raw`) so it can be sent back unchanged on the next request (the
// providers require their reasoning items, thought signatures or thinking blocks back).

export type { ProviderId } from '@/lib/shared/agentSettings';

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the input, from the shared verb module */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolImage {
  mediaType: 'image/png' | 'image/jpeg';
  base64: string;
}

export interface ToolResult {
  id: string;
  name: string;
  text: string;
  image?: ToolImage;
  isError: boolean;
}

export type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; calls: ToolCall[]; raw: unknown }
  | { role: 'tool'; results: ToolResult[] };

export interface ProviderRequest {
  system: string;
  tools: ToolSpec[];
  turns: Turn[];
  model: string;
  /** held in memory only; empty for a local endpoint that needs none */
  key: string;
  /** the local endpoint's base (scheme, host, port); unused by the cloud providers */
  endpoint: string;
  signal: AbortSignal;
}

export interface ProviderReply {
  text: string;
  calls: ToolCall[];
  raw: unknown;
}

export type Adapter = (req: ProviderRequest) => Promise<ProviderReply>;

/** An error the panel shows as is: plain words, never a stack. */
export class ProviderError extends Error {}

/** POST JSON and read JSON, with errors in plain words. */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  who: string,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ProviderError(
      `could not reach ${who}. Check the network or, for a local endpoint, that the server runs and allows this page (CORS).`,
    );
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const detail = errorText(data);
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError(`${who} refused the key (${res.status})${detail ? `: ${detail}` : ''}.`);
    }
    if (res.status === 429) throw new ProviderError(`${who} is rate limiting this account (429). Wait and try again.`);
    throw new ProviderError(`${who} answered ${res.status}${detail ? `: ${detail}` : ''}.`);
  }
  if (!data) throw new ProviderError(`${who} sent a reply that is not JSON.`);
  return data;
}

function errorText(data: Record<string, unknown> | null): string {
  if (!data) return '';
  const e = data.error as { message?: unknown } | string | undefined;
  if (typeof e === 'string') return e;
  if (e && typeof e.message === 'string') return e.message;
  return '';
}

/** parse a JSON arguments string from a model; a malformed one becomes an empty object */
export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
