// The in-page agent's setup check (components/cbct/agent/catalog.ts, switchOnProblem): the
// opt-in dialogue opens only when a provider is chosen, a cloud provider has its key, the model
// field is not empty for any provider, and a model server on this computer is on loopback.
import { describe, expect, it } from 'vitest';
import { LOCAL_PRESETS, switchOnProblem } from '../components/cbct/agent/catalog';

const LOCAL = LOCAL_PRESETS[0].endpoint;

describe('switching the agent on: what the setup must hold first', () => {
  it('a provider must be chosen', () => {
    expect(switchOnProblem({ providerId: '', key: '', model: 'm', endpoint: LOCAL })).toMatch(/^Choose a provider first/);
  });

  it('a cloud provider needs its key and a model', () => {
    expect(switchOnProblem({ providerId: 'anthropic', key: ' ', model: 'm', endpoint: LOCAL })).toBe('Enter your Anthropic API key.');
    expect(switchOnProblem({ providerId: 'openai', key: 'k', model: '  ', endpoint: LOCAL })).toBe('Enter a model name.');
    expect(switchOnProblem({ providerId: 'gemini', key: 'k', model: 'm', endpoint: LOCAL })).toBe('');
  });

  it('a model server on this computer needs a model too, empty or remembered empty', () => {
    // llama-server's preset leaves the model field empty, and an empty model may be remembered
    expect(LOCAL_PRESETS[0].model).toBe('');
    for (const model of ['', '   ']) {
      expect(switchOnProblem({ providerId: 'local', key: '', model, endpoint: LOCAL })).toBe(
        'Enter a model name: the name of the model your model server has loaded.',
      );
    }
    expect(switchOnProblem({ providerId: 'local', key: '', model: 'qwen3-vl:8b', endpoint: LOCAL })).toBe('');
  });

  it('a model server on this computer must be on loopback, and needs no key', () => {
    expect(switchOnProblem({ providerId: 'local', key: '', model: 'm', endpoint: 'http://192.168.1.4:8080' })).toMatch(
      /^The model server's address must be/,
    );
    expect(switchOnProblem({ providerId: 'local', key: '', model: 'm', endpoint: 'http://localhost:1234' })).toBe('');
  });
});
