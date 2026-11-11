// The desktop app remembers the window preset (Auto, Bone, Teeth, Soft) across a relaunch, in
// its own profile's page storage; the website remembers nothing new. Only the preset's name is
// kept: never a custom window, a folder, a file name or anything else from a scan. Pure
// functions over a Storage-like object, unit tested in tests/windowPreset.test.ts.

export const WINDOW_PRESET_KEY = 'cbctscope-window-preset';

type Voi = { center: number; width: number } | null;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** the preset a window is, by name, or null for a hand-set window */
export function presetNameOf(voi: Voi, presets: Record<string, Voi>): string | null {
  for (const [name, p] of Object.entries(presets)) {
    if (p === null ? voi === null : voi !== null && voi.center === p.center && voi.width === p.width) return name;
  }
  return null;
}

/**
 * The window to open with: the remembered preset's window on the desktop app, or undefined
 * when there is nothing to restore (the website, a first launch, an unknown name, no storage).
 */
export function rememberedWindow(storage: StorageLike | null, isDesktop: boolean, presets: Record<string, Voi>): Voi | undefined {
  if (!isDesktop || !storage) return undefined;
  try {
    const name = storage.getItem(WINDOW_PRESET_KEY);
    return name !== null && Object.prototype.hasOwnProperty.call(presets, name) ? presets[name] : undefined;
  } catch {
    return undefined;
  }
}

/** keep the preset's name on the desktop app; a hand-set window leaves the last preset in place */
export function rememberWindow(storage: StorageLike | null, isDesktop: boolean, voi: Voi, presets: Record<string, Voi>): void {
  if (!isDesktop || !storage) return;
  const name = presetNameOf(voi, presets);
  if (name === null) return;
  try {
    storage.setItem(WINDOW_PRESET_KEY, name);
  } catch {
    /* storage full or blocked: nothing remembered */
  }
}

/** the page's storage when there is one (never on the server render) */
export function pageStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}
