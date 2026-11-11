// The window preset the desktop app remembers (components/cbct/windowPreset.ts): a preset's
// name only, on the desktop app only.
import { describe, expect, it } from 'vitest';
import { WINDOW_PRESET_KEY, presetNameOf, rememberWindow, rememberedWindow } from '../components/cbct/windowPreset';

const presets = { Auto: null, Bone: { center: 700, width: 4000 }, Soft: { center: 150, width: 900 } };
const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('the remembered window preset', () => {
  it('names a preset, and nothing for a hand-set window', () => {
    expect(presetNameOf(null, presets)).toBe('Auto');
    expect(presetNameOf({ center: 700, width: 4000 }, presets)).toBe('Bone');
    expect(presetNameOf({ center: 701, width: 4000 }, presets)).toBeNull();
  });
  it('the desktop app keeps the name and opens on it', () => {
    const s = store();
    rememberWindow(s, true, { center: 150, width: 900 }, presets);
    expect([...s.m.entries()]).toEqual([[WINDOW_PRESET_KEY, 'Soft']]);
    expect(rememberedWindow(s, true, presets)).toEqual({ center: 150, width: 900 });
    // a hand-set window leaves the last preset in place
    rememberWindow(s, true, { center: 12, width: 34 }, presets);
    expect(s.m.get(WINDOW_PRESET_KEY)).toBe('Soft');
    rememberWindow(s, true, null, presets);
    expect(rememberedWindow(s, true, presets)).toBeNull();
  });
  it('the website remembers nothing new', () => {
    const s = store();
    rememberWindow(s, false, { center: 700, width: 4000 }, presets);
    expect(s.m.size).toBe(0);
    s.m.set(WINDOW_PRESET_KEY, 'Bone');
    expect(rememberedWindow(s, false, presets)).toBeUndefined();
  });
  it('an unknown name or no storage restores nothing', () => {
    const s = store();
    s.m.set(WINDOW_PRESET_KEY, 'CT-Cardiac');
    expect(rememberedWindow(s, true, presets)).toBeUndefined();
    expect(rememberedWindow(null, true, presets)).toBeUndefined();
  });
});
