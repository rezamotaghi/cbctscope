// The in-page agent's key policy (docs/web-build.md, section 10, item 3): the provider key
// lives in module memory only. No file under components/cbct/agent/ may reach a storage API
// (localStorage, sessionStorage, IndexedDB, cookies, the Cache API); the remembered choices
// (provider, endpoint, model) go through lib/shared/agentSettings.ts, which writes those
// three fields and nothing else.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_SETTINGS_KEY, loadAgentSettings, saveAgentSettings } from '../lib/shared/agentSettings';
import { forgetKey, getKey, setKey } from '../components/cbct/agent/frame/keyStore';

const root = process.cwd();
const AGENT_DIR = path.join('components', 'cbct', 'agent');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...sources(rel));
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(rel);
  }
  return out;
}

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

const STORAGE_APIS = [
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bindexedDB\b/i,
  /\bIDB\w*/,
  /\bcookieStore\b/,
  /\.cookie\b/,
  /\bcaches\b/,
  /\bStorage\b/,
  /agentSettings/, // the settings module may be used by the panel only for the three choices
];

describe('the provider key is held in memory only', () => {
  const files = sources(AGENT_DIR);

  it('found the agent sources', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(files).toContain(path.join(AGENT_DIR, 'frame', 'keyStore.ts'));
  });

  it('no file under components/cbct/agent/ touches a storage API', () => {
    const hits: string[] = [];
    for (const f of files) {
      // a type-only import of the settings module carries no code
      const code = stripComments(readFileSync(path.join(root, f), 'utf8'))
        .split('\n')
        .filter((l) => !/^(?:export|import) type \{[^}]*\} from '@\/lib\/shared\/agentSettings';$/.test(l.trim()))
        .join('\n');
      for (const re of STORAGE_APIS) {
        if (re.source === 'agentSettings' && f.endsWith('AgentPanel.tsx')) continue;
        if (re.test(code)) hits.push(`${f}: ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the panel saves the three choices and never the key', () => {
    const panel = stripComments(readFileSync(path.join(root, AGENT_DIR, 'AgentPanel.tsx'), 'utf8'));
    const calls = [...panel.matchAll(/saveAgentSettings\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).not.toMatch(/key/i);
  });

  it('the settings module writes provider, endpoint and model only', () => {
    const written: Record<string, string> = {};
    const fake = { setItem: (k: string, v: string) => void (written[k] = v), getItem: (k: string) => written[k] ?? null };
    saveAgentSettings({ provider: 'openai', endpoint: 'e', model: 'm', key: 'sk-secret' } as never, fake);
    expect(Object.keys(written)).toEqual([AGENT_SETTINGS_KEY]);
    expect(JSON.parse(written[AGENT_SETTINGS_KEY])).toEqual({ provider: 'openai', endpoint: 'e', model: 'm' });
    expect(written[AGENT_SETTINGS_KEY]).not.toContain('sk-secret');
    expect(loadAgentSettings(fake)).toEqual({ provider: 'openai', endpoint: 'e', model: 'm' });
  });

  it('the key store forgets on demand', () => {
    setKey('  sk-test  ');
    expect(getKey()).toBe('sk-test');
    forgetKey();
    expect(getKey()).toBe('');
  });
});
