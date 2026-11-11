'use client';
// The in-page navigation agent (docs/web-build.md, sections 2 and 12; manual section 9.6).
// AgentToggle sits in the header; AgentPanel is a strip docked under the viewer that pushes
// the viewer up while open, so it never covers a control. Closed and off on every load. The
// clinician picks a provider, gives a key, and switches the agent on through the opt-in
// dialogue; the key is posted once to the sandboxed agent frame (agentFrame.ts), which alone
// holds it and alone talks to the provider. The session lives in agentUi.ts, so closing the
// panel unmounts it while a request in flight keeps its Stop in the header. Model prose is
// shown only in the labelled block, after the reading-term guard. Nothing is sent to any
// provider before the clinician confirms. Full contrast, nothing hidden or dimmed (hard rule 4).
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { loadAgentSettings, saveAgentSettings } from '@/lib/shared/agentSettings';
import { MODEL_TEXT_HEADING } from '@/lib/shared/readingTerms.mjs';
import { agentUi } from './agentUi';
import { IS_DESKTOP } from '../shell';
import { isLoopbackEndpoint, LOCAL_PRESETS, PROVIDERS, provider as providerOf, type ProviderId } from './catalog';


const LOCAL_NOTE = "The model server must accept requests from the agent's isolated frame (CORS); llama-server does by default.";

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
  endpoint,
  hasKey,
  onSwitchOn,
  onCancel,
}: {
  providerName: string;
  local: boolean;
  /** the model server's address (local only) */
  endpoint: string;
  /** a key was entered: only then does the dialogue speak of one */
  hasKey: boolean;
  onSwitchOn: () => void;
  onCancel: () => void;
}) {
  const where = local ? `the model server at ${endpoint}` : providerName;
  return (
    <div style={backdrop}>
      <div role="dialog" aria-modal="true" aria-labelledby="agent-optin-title" style={card}>
        <h2 id="agent-optin-title" style={{ fontSize: 16, margin: '0 0 10px' }}>
          Switch on the navigation agent
        </h2>
        <p style={{ margin: '0 0 8px' }}>
          {local ? `The agent runs on the model server at ${endpoint}.` : `The agent runs on your own model account with ${providerName}.`}
        </p>
        {hasKey && (
          <p style={{ margin: '0 0 8px' }}>
            {IS_DESKTOP
              ? "Your key stays in this app's memory and is forgotten when the app quits."
              : "Your key stays in this tab's memory and is forgotten when the tab closes."}
          </p>
        )}
        <p style={{ margin: '0 0 8px' }}>Every snapshot the agent asks for is sent to {where} and nowhere else.</p>
        <p style={{ margin: '0 0 8px' }}>Each snapshot is a picture of the open scan. Use de-identified scans.</p>
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


export default function AgentPanel() {
  const ui = useSyncExternalStore(agentUi.subscribe, agentUi.get, agentUi.server);
  if (!ui.open) return null; // closed = unmounted; the session and its header controls live on
  return <AgentPanelBody />;
}

function AgentPanelBody() {
  const ui = useSyncExternalStore(agentUi.subscribe, agentUi.get, agentUi.server);
  // no provider and no model until the clinician chooses one (or a remembered choice returns)
  const [providerId, setProviderId] = useState<ProviderId | ''>('');
  const [endpoint, setEndpoint] = useState(LOCAL_PRESETS[0].endpoint);
  const [model, setModel] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [setupError, setSetupError] = useState('');
  const [request, setRequest] = useState('');
  const logEnd = useRef<HTMLDivElement | null>(null);
  const modelEnd = useRef<HTMLDivElement | null>(null);

  // remembered choices (never the key), read after hydration
  useEffect(() => {
    const s = loadAgentSettings();
    if (s.provider) setProviderId(s.provider);
    if (s.endpoint) setEndpoint(s.endpoint);
    if (s.model !== undefined) setModel(s.model);
  }, []);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [ui.log]);
  useEffect(() => {
    modelEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [ui.modelText]);

  const chosen = providerId !== '';
  const info = providerOf(providerId || 'local');
  const local = providerId === 'local';
  const providerName = local ? `${info.label} (${endpoint})` : info.label;

  const chooseProvider = (id: ProviderId) => {
    setProviderId(id);
    setModel(providerOf(id).defaultModel);
    if (id === 'local') setEndpoint(LOCAL_PRESETS[0].endpoint);
    setSetupError('');
  };

  const askToSwitchOn = () => {
    if (!chosen) return setSetupError('Choose a provider first: a model server on this computer, or a cloud provider.');
    if (info.needsKey && !keyInput.trim()) return setSetupError(`Enter your ${info.label} API key.`);
    if (!local && !model.trim()) return setSetupError('Enter a model name.');
    if (local && !isLoopbackEndpoint(endpoint)) {
      return setSetupError("The model server's address must be http://127.0.0.1:<port> or http://localhost:<port>.");
    }
    setSetupError('');
    agentUi.setPhase('confirm');
  };

  const switchOn = () => {
    const key = keyInput.trim();
    setKeyInput(''); // the panel forgets the key; the frame gets it once
    if (!chosen) return;
    saveAgentSettings({ provider: providerId, endpoint, model: model.trim() });
    void agentUi.switchOn({ provider: providerId, model: model.trim(), endpoint, key });
  };

  const cancelOptIn = () => {
    setKeyInput('');
    agentUi.setPhase('setup');
  };

  const send = () => {
    const text = request.trim();
    if (!text || ui.busy || ui.phase !== 'on') return;
    setRequest('');
    void agentUi.send(text);
  };

  const closeButton = (
    <button style={button(false)} onClick={() => agentUi.setOpen(false)}>
      Close panel
    </button>
  );

  if (ui.phase === 'off') {
    return (
      <div style={strip} id="agent-panel" data-testid="agent-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <strong>Agent: off</strong>
          <span style={{ flex: 1 }} />
          {closeButton}
        </div>
        <p style={{ margin: '0 0 8px' }}>
          A navigation agent on your own model account: you ask for a view in words, it moves the camera, you read.
          It never produces findings. Nothing is sent anywhere until you switch it on.
        </p>
        <button style={button(true)} onClick={() => agentUi.setPhase('setup')}>
          Set up the navigation agent
        </button>
      </div>
    );
  }

  if (ui.phase === 'setup' || ui.phase === 'confirm' || ui.phase === 'starting') {
    return (
      <div style={strip} id="agent-panel" data-testid="agent-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <strong>{ui.phase === 'starting' ? 'Agent: starting' : 'Agent: off'}</strong>
          <span style={{ flex: 1 }}>
            A navigation agent on your own model account. It moves the camera; you read. It never produces findings.
          </span>
          {closeButton}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', columnGap: 12 }}>
        <label style={{ display: 'block', marginBottom: 6 }}>
          Provider
          <select
            style={field}
            value={providerId}
            onChange={(e) => e.target.value && chooseProvider(e.target.value as ProviderId)}
            aria-label="Provider"
          >
            {!chosen && <option value="">Choose a provider</option>}
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
          Model name
          <input
            style={field}
            aria-label="Model name"
            value={model}
            placeholder={!chosen ? 'filled in once you choose a provider' : local ? 'the model the server runs' : info.defaultModel}
            onChange={(e) => setModel(e.target.value)}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 6 }}>
          {!chosen ? 'API key' : local ? 'API key (only if the server asks for one)' : `${info.label} API key`}
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
        <p style={{ margin: '0 0 8px' }}>
          The key goes once to the agent&apos;s isolated frame, stays in its memory only and is never stored.
        </p>
        {local && <p style={{ margin: '0 0 8px' }}>{LOCAL_NOTE}</p>}
        {(setupError || ui.log.some((l) => l.who === 'error')) && (
          <p role="alert" style={{ margin: '0 0 8px', color: 'var(--warn)' }}>
            {setupError || ui.log.filter((l) => l.who === 'error').at(-1)?.text}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            style={button(false)}
            onClick={() => {
              setKeyInput('');
              setSetupError('');
              agentUi.setPhase('off');
            }}
          >
            Close
          </button>
          <button style={button(true)} onClick={askToSwitchOn} disabled={ui.phase === 'starting'}>
            Switch on…
          </button>
        </div>
        {ui.phase === 'confirm' && (
          <OptInDialog
            providerName={providerName}
            local={local}
            endpoint={endpoint}
            hasKey={keyInput.trim() !== ''}
            onSwitchOn={switchOn}
            onCancel={cancelOptIn}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ ...strip, display: 'flex', flexDirection: 'column' }} id="agent-panel" data-testid="agent-panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <strong>Agent: on, {ui.providerName}</strong>
        <span style={{ flex: 1 }}>Nothing the agent says is a finding. The read is yours.</span>
        <button style={button(false)} onClick={() => agentUi.switchOff()}>
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
        {ui.log.map((l, i) => (
          <div key={i} style={{ color: l.who === 'error' ? 'var(--warn)' : 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <b>{l.who === 'you' ? 'You' : l.who === 'tool' ? 'Step' : l.who === 'error' ? 'Error' : 'Note'}:</b> {l.text}
          </div>
        ))}
        {ui.busy && <div>Working…</div>}
        <div ref={logEnd} />
      </div>
      <section
        aria-label={MODEL_TEXT_HEADING}
        data-testid="agent-model-text"
        style={{
          flex: 1,
          minWidth: 0,
          overflowY: 'auto',
          border: '2px solid var(--text)',
          borderRadius: 6,
          padding: '6px 8px',
          background: 'var(--panel)',
          color: 'var(--text)',
        }}
      >
        <h3 style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700 }}>{MODEL_TEXT_HEADING}</h3>
        {ui.modelText.length === 0 && <div>No model text yet.</div>}
        {ui.modelText.map((m, i) => (
          <div key={i} data-replaced={m.replaced ? 'true' : undefined} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontStyle: m.replaced ? 'italic' : 'normal' }}>
            {m.text}
          </div>
        ))}
        <div ref={modelEnd} />
      </section>
      <div style={{ width: 300, maxWidth: '35%', display: 'flex', flexDirection: 'column' }}>
      <textarea
        style={{ ...field, flex: 1, minHeight: 48, resize: 'none' }}
        aria-label="Request to the agent"
        value={request}
        placeholder="show the left TMJ in sagittal, bone window"
        onChange={(e) => setRequest(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
        <button style={button(false)} onClick={() => agentUi.stop()}>
          Stop
        </button>
        <button style={button(true)} onClick={send}>
          Send
        </button>
      </div>
      </div>
      </div>
    </div>
  );
}

/**
 * The header's agent controls: the Agent button opens and closes the docked panel and shows the
 * status while on; Stop is here whenever a request runs (open panel or not), and Switch off
 * whenever the agent is on.
 */
export function AgentToggle() {
  const ui = useSyncExternalStore(agentUi.subscribe, agentUi.get, agentUi.server);
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button
        style={{ ...button(ui.open), fontSize: 11, padding: '2px 8px' }}
        aria-expanded={ui.open}
        aria-controls="agent-panel"
        data-testid="agent-status"
        title="the opt-in navigation agent on your own model account: it moves the camera and never produces findings. Opens the panel under the viewer."
        onClick={() => agentUi.toggle()}
      >
        {ui.status ?? 'Agent: off'}
      </button>
      {ui.busy && (
        <button
          style={{ ...button(false), fontSize: 11, padding: '2px 8px' }}
          data-testid="agent-header-stop"
          onClick={() => agentUi.stop()}
        >
          Stop
        </button>
      )}
      {ui.status && (
        <button style={{ ...button(false), fontSize: 11, padding: '2px 8px' }} onClick={() => agentUi.switchOff()}>
          Switch off
        </button>
      )}
    </span>
  );
}
