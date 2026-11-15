// The in-page agent's loop, tool routing and the four provider adapters' request shapes,
// with fetch stubbed (no network, no key). The shapes are the documented ones each adapter
// names in its header comment.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPageTransport, type AgentCommand, type PageTransport } from '../components/cbct/agentTransport';
import { MAX_TOOL_CALLS, RunawayError, runTurn } from '../components/cbct/agent/frame/loop';
import { SYSTEM_PROMPT } from '../components/cbct/agent/prompt';
import { executeTool } from '../components/cbct/agent/tools';
import { anthropicAdapter } from '../components/cbct/agent/frame/providers/anthropic';
import { openaiAdapter } from '../components/cbct/agent/frame/providers/openai';
import { geminiAdapter, geminiDeclaration, geminiSchema } from '../components/cbct/agent/frame/providers/gemini';
import { localAdapter } from '../components/cbct/agent/frame/providers/local';
import { parseArgs, type Adapter, type ProviderRequest, type Turn } from '../components/cbct/agent/frame/providers/types';
import { PAGE_TOOLS } from '../components/cbct/agent/tools';

/** a page transport whose viewer answers every verb with a small state (and a PNG for snapshot) */
function fakeViewer(): { transport: PageTransport; seen: AgentCommand[] } {
  const transport = createPageTransport();
  const seen: AgentCommand[] = [];
  transport.subscribe(
    (cmd) => {
      seen.push(cmd);
      const state = { viewMode: cmd.verb === 'set_view_mode' ? cmd.args.mode : 'mpr', volume: null };
      const result = cmd.verb === 'snapshot' ? { pngBase64: 'iVBORw0KGgo=', state } : cmd.verb === 'views' && cmd.args.op === 'list' ? { views: [] } : state;
      void transport.reply(cmd.id, { ok: true, result });
    },
    () => {},
  );
  return { transport, seen };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tool routing', () => {
  it('refuses an unknown tool and malformed arguments without moving anything', async () => {
    const { transport, seen } = fakeViewer();
    expect((await executeTool(transport, 'run_code', {})).isError).toBe(true);
    const bad = await executeTool(transport, 'set_view_mode', { mode: 'xray' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/invalid arguments/);
    expect(seen).toEqual([]);
  });

  it('maps the MCP verbs onto the bridge verbs the way the MCP server does', async () => {
    const { transport, seen } = fakeViewer();
    await executeTool(transport, 'viewer_state', {});
    await executeTool(transport, 'goto_view', { view: 'Left TMJ' });
    await executeTool(transport, 'save_view', { name: 'Left TMJ' });
    await executeTool(transport, 'list_views', {});
    await executeTool(transport, 'reset_view', {});
    expect(seen.map((c) => [c.verb, c.args])).toEqual([
      ['get_state', {}],
      ['views', { view: 'Left TMJ', op: 'goto' }],
      ['views', { name: 'Left TMJ', op: 'save' }],
      ['views', { op: 'list' }],
      ['reset_view', { full: false }],
    ]);
  });

  it('answers open_scan and pick_scan with a pointer to the open menu', async () => {
    const { transport, seen } = fakeViewer();
    for (const name of ['open_scan', 'pick_scan']) {
      const r = await executeTool(transport, name, name === 'open_scan' ? { path: '/x' } : {});
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/open menu/);
    }
    expect(seen).toEqual([]);
  });

  it('returns a snapshot as an image with the state caption', async () => {
    const { transport } = fakeViewer();
    const r = await executeTool(transport, 'snapshot', {});
    expect(r.isError).toBe(false);
    expect(r.image).toEqual({ mediaType: 'image/png', base64: 'iVBORw0KGgo=' });
    expect(r.text).toMatch(/mode mpr/);
  });
});

describe('the loop', () => {
  const base = { model: 'm', key: 'k', endpoint: '', onEvent: () => {}, system: SYSTEM_PROMPT, tools: PAGE_TOOLS };
  const execVia = (transport: PageTransport) => (name: string, args: Record<string, unknown>, signal: AbortSignal) =>
    executeTool(transport, name, args, signal);

  it('states the fence in the system prompt', () => {
    expect(SYSTEM_PROMPT).toMatch(/never interpret/i);
    expect(SYSTEM_PROMPT).toMatch(/reading the images is the clinician's/);
    expect(SYSTEM_PROMPT).toMatch(/fifteen CBCTScope verbs/);
  });

  it('runs tool calls through the transport until the model answers in text', async () => {
    const { transport, seen } = fakeViewer();
    const replies = [
      { text: '', calls: [{ id: '1', name: 'set_view_mode', args: { mode: 'tmj' } }], raw: 'a' },
      { text: '', calls: [{ id: '2', name: 'snapshot', args: {} }], raw: 'b' },
      { text: 'TMJ mode is on screen.', calls: [], raw: 'c' },
    ];
    const reqs: ProviderRequest[] = [];
    const adapter: Adapter = async (req) => {
      reqs.push({ ...req, turns: [...req.turns] });
      return replies.shift()!;
    };
    const turns: Turn[] = [];
    const text = await runTurn({ ...base, adapter, exec: execVia(transport), turns, request: 'show the TMJ', signal: new AbortController().signal });
    expect(text).toBe('TMJ mode is on screen.');
    expect(seen.map((c) => c.verb)).toEqual(['set_view_mode', 'snapshot']);
    expect(reqs[0].tools).toBe(PAGE_TOOLS);
    const last = reqs[2].turns.at(-1);
    expect(last?.role).toBe('tool');
    expect(last && last.role === 'tool' && last.results[0].image?.mediaType).toBe('image/png');
  });

  it(`stops a runaway turn after ${MAX_TOOL_CALLS} tool calls`, async () => {
    const { transport, seen } = fakeViewer();
    let n = 0;
    const adapter: Adapter = async () => ({ text: '', calls: [{ id: String(++n), name: 'viewer_state', args: {} }], raw: n });
    await expect(
      runTurn({ ...base, adapter, exec: execVia(transport), turns: [], request: 'loop', signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(RunawayError);
    expect(seen.length).toBe(MAX_TOOL_CALLS);
  });

  it('stops when aborted', async () => {
    const { transport, seen } = fakeViewer();
    const ctrl = new AbortController();
    const adapter: Adapter = async () => {
      ctrl.abort();
      return { text: '', calls: [{ id: '1', name: 'viewer_state', args: {} }], raw: 1 };
    };
    await expect(runTurn({ ...base, adapter, exec: execVia(transport), turns: [], request: 'x', signal: ctrl.signal })).rejects.toThrow();
    expect(seen).toEqual([]);
  });

  it('answers malformed or truncated tool-call JSON with an argument error and runs nothing', async () => {
    const { transport, seen } = fakeViewer();
    const replies = [
      { text: '', calls: [{ id: '1', name: 'set_view_mode', args: {}, argsError: parseArgs('{"mode": "tm').error }], raw: 'a' },
      { text: 'done', calls: [], raw: 'b' },
    ];
    const reqs: ProviderRequest[] = [];
    const adapter: Adapter = async (req) => {
      reqs.push({ ...req, turns: [...req.turns] });
      return replies.shift()!;
    };
    await runTurn({ ...base, adapter, exec: execVia(transport), turns: [], request: 'x', signal: new AbortController().signal });
    expect(seen).toEqual([]);
    const result = reqs[1].turns.at(-1);
    expect(result?.role === 'tool' && result.results[0]).toMatchObject({ isError: true });
    expect(result?.role === 'tool' && result.results[0].text).toMatch(/invalid arguments for set_view_mode: .*malformed or truncated JSON/);
  });
});

describe('parseArgs', () => {
  it('passes objects and empty input, and reports anything else as an error', () => {
    expect(parseArgs('{"mode":"tmj"}')).toEqual({ args: { mode: 'tmj' } });
    expect(parseArgs({ mode: 'tmj' })).toEqual({ args: { mode: 'tmj' } });
    expect(parseArgs('')).toEqual({ args: {} });
    expect(parseArgs(undefined)).toEqual({ args: {} });
    for (const bad of ['{"mode": "tm', 'not json', '[1,2]', '42', 'null']) {
      const r = parseArgs(bad);
      expect(r.args).toEqual({});
      expect(r.error, bad).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------- adapters

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function stubFetch(reply: unknown): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

const toolTurns: Turn[] = [
  { role: 'user', text: 'snap' },
  { role: 'assistant', text: '', calls: [{ id: 'c1', name: 'snapshot', args: {} }], raw: 'RAW' },
  { role: 'tool', results: [{ id: 'c1', name: 'snapshot', text: 'mode mpr', image: { mediaType: 'image/png', base64: 'AAAA' }, isError: false }] },
];

const req = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  system: 'SYS',
  tools: PAGE_TOOLS,
  turns: toolTurns,
  model: 'model-x',
  key: 'secret',
  endpoint: 'http://127.0.0.1:9999',
  signal: new AbortController().signal,
  ...over,
});

describe('adapters', () => {
  it('Anthropic: Messages API, browser-access header, tool_result with an image block', async () => {
    const calls = stubFetch({ content: [{ type: 'tool_use', id: 't', name: 'viewer_state', input: {} }], stop_reason: 'tool_use' });
    const turns: Turn[] = [toolTurns[0], { ...toolTurns[1], raw: [{ type: 'tool_use', id: 'c1', name: 'snapshot', input: {} }] } as Turn, toolTurns[2]];
    const out = await anthropicAdapter(req({ turns }));
    const c = calls[0];
    expect(c.url).toBe('https://api.anthropic.com/v1/messages');
    expect(c.headers['x-api-key']).toBe('secret');
    expect(c.headers['anthropic-version']).toBe('2026-10-21');
    expect(c.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(c.body.system).toBe('SYS');
    expect((c.body.tools as { input_schema: unknown }[])[0].input_schema).toEqual(PAGE_TOOLS[0].parameters);
    const msgs = c.body.messages as { role: string; content: unknown }[];
    const result = (msgs[2].content as { type: string; tool_use_id: string; content: { type: string; source?: unknown }[] }[])[0];
    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('c1');
    expect(result.content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
    expect(out.calls).toEqual([{ id: 't', name: 'viewer_state', args: {} }]);
  });

  it('OpenAI: Responses API, stateless replay, function_call_output with an input_image', async () => {
    const calls = stubFetch({ status: 'completed', output: [{ type: 'function_call', call_id: 'k', name: 'set_view_mode', arguments: '{"mode":"tmj"}' }] });
    const turns: Turn[] = [toolTurns[0], { ...toolTurns[1], raw: [{ type: 'function_call', call_id: 'c1', name: 'snapshot', arguments: '{}' }] } as Turn, toolTurns[2]];
    const out = await openaiAdapter(req({ turns }));
    const c = calls[0];
    expect(c.url).toBe('https://api.openai.com/v1/responses');
    expect(c.headers.authorization).toBe('Bearer secret');
    expect(c.body.store).toBe(false);
    expect(c.body.instructions).toBe('SYS');
    expect((c.body.tools as { type: string; name: string }[])[0]).toMatchObject({ type: 'function', name: 'open_scan' });
    const input = c.body.input as Record<string, unknown>[];
    expect(input[1]).toEqual({ type: 'function_call', call_id: 'c1', name: 'snapshot', arguments: '{}' });
    expect(input[2]).toEqual({
      type: 'function_call_output',
      call_id: 'c1',
      output: [
        { type: 'input_text', text: 'mode mpr' },
        { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
      ],
    });
    expect(out.calls).toEqual([{ id: 'k', name: 'set_view_mode', args: { mode: 'tmj' } }]);
  });

  it('Gemini: generateContent, OpenAPI-subset declarations, functionResponse with inlineData', async () => {
    const calls = stubFetch({ candidates: [{ content: { role: 'model', parts: [{ text: 'done' }] }, finishReason: 'STOP' }] });
    const turns: Turn[] = [toolTurns[0], { ...toolTurns[1], raw: { role: 'model', parts: [{ functionCall: { name: 'snapshot', args: {}, id: 'c1' }, thoughtSignature: 'sig' }] } } as Turn, toolTurns[2]];
    const out = await geminiAdapter(req({ turns }));
    const c = calls[0];
    expect(c.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/model-x:generateContent');
    expect(c.headers['x-goog-api-key']).toBe('secret');
    const contents = c.body.contents as { role: string; parts: Record<string, unknown>[] }[];
    expect(contents[1].parts[0].thoughtSignature).toBe('sig');
    expect(contents[2].parts[0]).toEqual({
      functionResponse: { name: 'snapshot', id: 'c1', response: { result: 'mode mpr' }, parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] },
    });
    expect(out.text).toBe('done');
  });

  it('Gemini: declarations drop what the subset lacks and omit empty parameters', () => {
    const nav = PAGE_TOOLS.find((t) => t.name === 'navigate_slice')!;
    const s = geminiSchema(nav.parameters);
    expect(s.type).toBe('OBJECT');
    expect((s.properties as Record<string, Record<string, unknown>>).index).toEqual({
      type: 'INTEGER',
      description: "absolute slice index, 0-based, in the pane's own count (label number minus 1)",
    });
    expect(JSON.stringify(s)).not.toMatch(/additionalProperties|\$schema/);
    expect(geminiDeclaration(PAGE_TOOLS.find((t) => t.name === 'snapshot')!)).not.toHaveProperty('parameters');
  });

  it('local: chat completions, no key header when none, the image as a user image_url part', async () => {
    const calls = stubFetch({ choices: [{ message: { role: 'assistant', content: 'ok' } }] });
    const turns: Turn[] = [toolTurns[0], { ...toolTurns[1], raw: { role: 'assistant', content: '', tool_calls: [] } } as Turn, toolTurns[2]];
    const out = await localAdapter(req({ turns, key: '', model: '' }));
    const c = calls[0];
    expect(c.url).toBe('http://127.0.0.1:9999/v1/chat/completions');
    expect(c.headers.authorization).toBeUndefined();
    expect(c.body).not.toHaveProperty('model');
    const msgs = c.body.messages as Record<string, unknown>[];
    expect(msgs[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'mode mpr' });
    expect((msgs[4].content as Record<string, unknown>[])[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
    expect(out.text).toBe('ok');
  });

  it('turns HTTP errors into plain words', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }));
    await expect(anthropicAdapter(req())).rejects.toThrow(/Anthropic refused the key \(401\): invalid x-api-key/);
  });
});
