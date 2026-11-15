// The window preset the desktop app remembers (components/cbct/windowPreset.ts): a preset's
// name only, on the desktop app only, stored when the reader picks one and applied to every CT
// volume that opens; a radiograph always opens on Auto.
import { describe, expect, it } from 'vitest';
import { WINDOW_PRESET_KEY, presetNameOf, rememberPreset, rememberedWindow, windowOnOpen } from '../components/cbct/windowPreset';

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
  it('the desktop app keeps the picked name and opens on it', () => {
    const s = store();
    rememberPreset(s, true, 'Soft', presets);
    expect([...s.m.entries()]).toEqual([[WINDOW_PRESET_KEY, 'Soft']]);
    expect(rememberedWindow(s, true, presets)).toEqual({ center: 150, width: 900 });
    rememberPreset(s, true, 'Auto', presets);
    expect(rememberedWindow(s, true, presets)).toBeNull();
    // an unknown name is never stored
    rememberPreset(s, true, 'CT-Cardiac', presets);
    expect(s.m.get(WINDOW_PRESET_KEY)).toBe('Auto');
  });
  it('survives relaunch, then an open, then a relaunch', () => {
    const s = store();
    rememberPreset(s, true, 'Bone', presets); // the reader picks Bone
    // relaunch: the first CT volume opens on Bone
    expect(windowOnOpen(s, true, false, presets)).toEqual({ center: 700, width: 4000 });
    // open another CT volume, then switch to a radiograph and back: only a pick writes, so the
    // opens leave the name alone; the radiograph opens on Auto
    expect(windowOnOpen(s, true, false, presets)).toEqual({ center: 700, width: 4000 });
    expect(windowOnOpen(s, true, true, presets)).toBeNull();
    expect(windowOnOpen(s, true, false, presets)).toEqual({ center: 700, width: 4000 });
    expect(s.m.get(WINDOW_PRESET_KEY)).toBe('Bone');
    // relaunch again: still Bone
    expect(windowOnOpen(s, true, false, presets)).toEqual({ center: 700, width: 4000 });
  });
  it('the website remembers nothing new and opens on Auto', () => {
    const s = store();
    rememberPreset(s, false, 'Bone', presets);
    expect(s.m.size).toBe(0);
    s.m.set(WINDOW_PRESET_KEY, 'Bone');
    expect(rememberedWindow(s, false, presets)).toBeUndefined();
    expect(windowOnOpen(s, false, false, presets)).toBeNull();
  });
  it('an unknown name or no storage restores nothing', () => {
    const s = store();
    s.m.set(WINDOW_PRESET_KEY, 'CT-Cardiac');
    expect(rememberedWindow(s, true, presets)).toBeUndefined();
    expect(rememberedWindow(null, true, presets)).toBeUndefined();
    expect(windowOnOpen(null, true, false, presets)).toBeNull();
  });
});
