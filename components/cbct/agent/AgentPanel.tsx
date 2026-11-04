'use client';
// The in-page navigation agent (docs/web-build.md, section 10, item 3; manual section 9.6).
// AgentToggle sits in the header; AgentPanel is a strip docked under the viewer that pushes
// the viewer up while open, so it never covers a control. Closed and off on every load. The clinician picks a provider, gives a key (memory only), and
// switches the agent on through the opt-in dialogue; from then on the panel says so at all
// times and offers Switch off. Requests run through loop.ts; nothing is sent to any provider
// before the clinician confirms. Full contrast, nothing hidden or dimmed (hard rule 4).
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PageTransport } from '../agentTransport';
import { loadAgentSettings, saveAgentSettings } from '@/lib/shared/agentSettings';
import { agentUi } from './agentUi';
import { forgetKey, getKey, setKey } from './keyStore';
import { MAX_TOOL_CALLS, runTurn, type AgentEvent } from './loop';
import { PROVIDERS, provider as providerOf } from './providers';
import { isLoopbackEndpoint, LOCAL_PRESETS } from './providers/hosts';
import type { ProviderId, Turn } from './providers/types';

type Phase = 'off' | 'setup' | 'confirm' | 'on';

interface LogLine {
  who: 'you' | 'agent' | 'tool' | 'error' | 'note';
  text: string;
}

const LOCAL_NOTE = 'Your browser decides whether a page may reach a local server; the desktop app always can.';

/** the docked strip under the viewer: fixed height, never over a control (hard rule 4) */
export const AGENT_STRIP_HEIGHT = 220;

const strip: React.CSSProperties = {
  flexShrink: 0,
  height: AGENT_STRIP_HEIGHT,
  boxSizing: 'border-box',
  overflowY: 'auto',
  background: 'var(--panel)',
  color: 'var(--text)',
  borderTop: '1px solid var(--border)',
  padding: '8px 12px',
  fontSize: 12,
  lineHeight: 1.5,
};

const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--panel-2)',
  color: 'var(--text)',
  fontSize: 12,
};

const button = (primary: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: primary ? 'var(--accent-dim)' : 'var(--panel-2)',
  color: 'var(--text)',
  fontSize: 12,
  fontWeight: primary ? 600 : 400,
});

// the opt-in dialogue matches WebDialogs.tsx
const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
};

const card: React.CSSProperties = {
  maxWidth: 460,
  width: '100%',
  background: 'var(--panel)',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
  padding: '18px 20px',
  fontSize: 13,
  lineHeight: 1.6,
};

const dialogButton = (primary: boolean): React.CSSProperties => ({ ...button(primary), padding: '6px 14px', fontSize: 13 });

export function OptInDialog({
  providerName,
  local,
  onSwitchOn,
  onCancel,
}: {
  providerName: string;
  local: boolean;
  onSwitchOn: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={backdrop}>
      <div role="dialog" aria-modal="true" aria-labelledby="agent-optin-title" style={card}>
        <h2 id="agent-optin-title" style={{ fontSize: 16, margin: '0 0 10px' }}>
          Switch on the navigation agent
        </h2>
        <p style={{ margin: '0 0 8px' }}>The agent runs on your own model account with {providerName}.</p>
        <p style={{ margin: '0 0 8px' }}>Your key stays in this tab&apos;s memory and is forgotten when the tab closes.</p>
        <p style={{ margin: '0 0 8px' }}>Every snapshot the agent asks for is sent to {providerName} and nowhere else.</p>
        <p style={{ margin: local ? '0 0 8px' : '0 0 14px' }}>
          The agent only moves the camera. It is not asked for findings, and nothing it says is a finding.
        </p>
        {local && <p style={{ margin: '0 0 14px' }}>{LOCAL_NOTE}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={dialogButton(false)} onClick={onCancel}>
            Cancel
          </button>
          <button style={dialogButton(true)} onClick={onSwitchOn} autoFocus>
            Switch on
          </button>
        </div>
      </div>
    </div>
  );
}

const fmtArgs = (a: Record<string, unknown>) => (Object.keys(a).length ? ` ${JSON.stringify(a)}` : '');

export default function AgentPanel({ transport }: { transport: PageTransport }) {
  const [phase, setPhase] = useState<Phase>('off');
  const [providerId, setProviderId] = useState<ProviderId>('anthropic');
  const [endpoint, setEndpoint] = useState(LOCAL_PRESETS[0].endpoint);
  const [model, setModel] = useState(PROVIDERS[0].defaultModel);
  const [keyInput, setKeyInput] = useState('');
  const [setupError, setSetupError] = useState('');
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const turns = useRef<Turn[]>([]);
  const abort = useRef<AbortController | null>(null);
  const logEnd = useRef<HTMLDivElement | null>(null);

  // remembered choices (never the key), read after hydration
  useEffect(() => {
    const s = loadAgentSettings();
    if (s.provider) setProviderId(s.provider);
    if (s.endpoint) setEndpoint(s.endpoint);
    if (s.model !== undefined) setModel(s.model);
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [log]);

  // a closed or reloaded tab forgets the key anyway; an unmounted panel stops its request
  useEffect(
    () => () => {
      abort.current?.abort();
      forgetKey();
    },
    [],
  );

  const info = providerOf(providerId);
  const local = providerId === 'local';
  const providerName = local ? `${info.label} (${endpoint})` : info.label;
  const add = (line: LogLine) => setLog((l) => [...l, line]);

  const chooseProvider = (id: ProviderId) => {
    setProviderId(id);
    setModel(providerOf(id).defaultModel);
    if (id === 'local') setEndpoint(LOCAL_PRESETS[0].endpoint);
    setSetupError('');
  };

  const askToSwitchOn = () => {
    if (info.needsKey && !keyInput.trim()) return setSetupError(`Enter your ${info.label} API key.`);
    if (!local && !model.trim()) return setSetupError('Enter a model id.');
    if (local && !isLoopbackEndpoint(endpoint)) {
      return setSetupError('The local endpoint must be http://127.0.0.1:<port> or http://localhost:<port>.');
    }
    setSetupError('');
    setPhase('confirm');
  };

  const switchOn = () => {
    setKey(keyInput);
    setKeyInput('');
    saveAgentSettings({ provider: providerId, endpoint, model: model.trim() });
    turns.current = [];
    setLog([{ who: 'note', text: `Ask for a view, for example: "show the left TMJ in sagittal, bone window". At most ${MAX_TOOL_CALLS} steps per request.` }]);
    setPhase('on');
  };

  const cancelOptIn = () => {
    setKeyInput('');
    setPhase('setup');
  };

  const switchOff = () => {
    abort.current?.abort();
    abort.current = null;
    forgetKey();
    turns.current = [];
    setBusy(false);
    setLog([]);
    setRequest('');
    setPhase('off');
  };

  const stop = () => {
    abort.current?.abort();
  };

  const send = async () => {
    const text = request.trim();
    if (!text || busy || phase !== 'on') return;
    setRequest('');
    add({ who: 'you', text });
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    const conversation = turns.current;
    const mark = conversation.length;
    const onEvent = (e: AgentEvent) => {
      if (ctrl.signal.aborted) return;
      if (e.kind === 'text') add({ who: 'agent', text: e.text });
      else if (e.kind === 'call') add({ who: 'tool', text: `${e.name}${fmtArgs(e.args)}` });
      else if (e.isError) add({ who: 'error', text: `${e.name}: ${e.text}` });
      else if (e.image) add({ who: 'note', text: `snapshot sent to ${providerName}` });
    };
    try {
      await runTurn({
        adapter: info.adapter,
        transport,
        model: model.trim(),
        key: getKey(),
        endpoint,
        turns: conversation,
        request: text,
        signal: ctrl.signal,
        onEvent,
      });
    } catch (err) {
      // a failed or stopped request leaves no half turn behind for the next one
      conversation.length = mark;
      if (ctrl.signal.aborted) {
        if (abort.current === ctrl) add({ who: 'note', text: 'Stopped.' });
      } else {
        add({ who: 'error', text: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        setBusy(false);
      }
    }
  };

  const ui = useSyncExternalStore(agentUi.subscribe, agentUi.get, agentUi.server);
  const closeButton = (
    <button style={button(false)} onClick={() => agentUi.set({ open: false })}>
      Close panel
    </button>
  );

  // the header toggle shows the status and offers Switch off too
  const switchOffRef = useRef(switchOff);
  switchOffRef.current = switchOff;
  useEffect(() => {
    agentUi.set({ status: phase === 'on' ? `Agent: on, ${providerName}` : null });
  }, [phase, providerName]);
  useEffect(() => {
    agentUi.onSwitchOff(() => switchOffRef.current());
    return () => {
      agentUi.onSwitchOff(null);
      agentUi.set({ status: null, open: false });
    };
  }, []);

  if (phase === 'off') {
    return (
      <div style={{ ...strip, display: ui.open ? 'block' : 'none' }} id="agent-panel" data-testid="agent-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <strong>Agent: off</strong>
          <span style={{ flex: 1 }} />
          {closeButton}
        </div>
        <p style={{ margin: '0 0 8px' }}>
          A navigation agent on your own model account: you ask for a view in words, it moves the camera, you read.
          Nothing is sent anywhere until you switch it on.
        </p>
        <button style={button(true)} onClick={() => setPhase('setup')}>
          Set up the navigation agent
        </button>
      </div>
    );
  }

  if (phase === 'setup' || phase === 'confirm') {
    return (
      <div style={{ ...strip, display: ui.open ? 'block' : 'none' }} id="agent-panel" data-testid="agent-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <strong>Agent: off</strong>
          <span style={{ flex: 1 }}>A navigation agent on your own model account. It moves the camera; you read.</span>
          {closeButton}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', columnGap: 12 }}>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Provider
          <select
            style={field}
            value={providerId}
            onChange={(e) => chooseProvider(e.target.value as ProviderId)}
            aria-label="Provider"
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {local && (
          <>
            <label style={{ display: 'block', marginBottom: 6 }}>
              Preset
              <select
                style={field}
                aria-label="Preset"
                value={LOCAL_PRESETS.find((p) => p.endpoint === endpoint)?.id ?? ''}
                onChange={(e) => {
                  const p = LOCAL_PRESETS.find((x) => x.id === e.target.value);
                  if (p) {
                    setEndpoint(p.endpoint);
                    setModel(p.model);
                  }
                }}
              >
                {LOCAL_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.endpoint})
                  </option>
                ))}
                <option value="">custom</option>
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 6 }}>
              Endpoint
              <input style={field} aria-label="Endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
            </label>
            <p style={{ margin: '0 0 6px' }}>
              A preset only fills in the address: any port on 127.0.0.1 or localhost works. Start llama-server with
              --port 8080, or type the port it listens on.
            </p>
          </>
        )}
        <label style={{ display: 'block', marginBottom: 6 }}>
          Model id
          <input
            style={field}
            aria-label="Model id"
            value={model}
            placeholder={local ? 'the model the server runs' : info.defaultModel}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          {local ? 'API key (only if the server asks for one)' : `${info.label} API key`}
          <input
            style={field}
            aria-label="API key"
            type="password"
            autoComplete="off"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
          />
        </label>
        </div>
        <p style={{ margin: '0 0 8px' }}>The key stays in this tab&apos;s memory only and is never stored.</p>
        {local && <p style={{ margin: '0 0 8px' }}>{LOCAL_NOTE}</p>}
        {setupError && (
          <p role="alert" style={{ margin: '0 0 8px', color: 'var(--warn)' }}>
            {setupError}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            style={button(false)}
            onClick={() => {
              setKeyInput('');
              setSetupError('');
              setPhase('off');
            }}
          >
            Close
          </button>
          <button style={button(true)} onClick={askToSwitchOn}>
            Switch on…
          </button>
        </div>
        {phase === 'confirm' && (
          <OptInDialog providerName={providerName} local={local} onSwitchOn={switchOn} onCancel={cancelOptIn} />
        )}
      </div>
    );
  }

  return (
    <div style={{ ...strip, display: ui.open ? 'flex' : 'none', flexDirection: 'column' }} id="agent-panel" data-testid="agent-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <strong>Agent: on, {providerName}</strong>
        <span style={{ flex: 1 }}>Nothing the agent says is a finding. The read is yours.</span>
        <button style={button(false)} onClick={switchOff}>
          Switch off
        </button>
        {closeButton}
      </div>
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
      <div
        aria-live="polite"
        data-testid="agent-log"
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '6px 8px',
          background: 'var(--panel-2)',
        }}
      >
        {log.map((l, i) => (
          <div key={i} style={{ color: l.who === 'error' ? 'var(--warn)' : 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <b>{l.who === 'you' ? 'You' : l.who === 'agent' ? 'Agent' : l.who === 'tool' ? 'Step' : l.who === 'error' ? 'Error' : 'Note'}:</b>{' '}
            {l.text}
          </div>
        ))}
        {busy && <div>Working…</div>}
        <div ref={logEnd} />
      </div>
      <div style={{ width: 340, maxWidth: '45%', display: 'flex', flexDirection: 'column' }}>
      <textarea
        style={{ ...field, flex: 1, minHeight: 48, resize: 'none' }}
        aria-label="Request to the agent"
        value={request}
        placeholder="show the left TMJ in sagittal, bone window"
        onChange={(e) => setRequest(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
        <button style={button(false)} onClick={stop}>
          Stop
        </button>
        <button style={button(true)} onClick={() => void send()}>
          Send
        </button>
      </div>
      </div>
      </div>
    </div>
  );
}

/** The header's Agent button: opens and closes the docked panel; shows the status while on. */
export function AgentToggle() {
  const ui = useSyncExternalStore(agentUi.subscribe, agentUi.get, agentUi.server);
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button
        style={{ ...button(ui.open), fontSize: 11, padding: '2px 8px' }}
        aria-expanded={ui.open}
        aria-controls="agent-panel"
        data-testid="agent-status"
        title="the opt-in navigation agent on your own model account: opens the panel under the viewer"
        onClick={() => agentUi.toggle()}
      >
        {ui.status ?? 'Agent: off'}
      </button>
      {ui.status && (
        <button style={{ ...button(false), fontSize: 11, padding: '2px 8px' }} onClick={() => agentUi.switchOff()}>
          Switch off
        </button>
      )}
    </span>
  );
}
