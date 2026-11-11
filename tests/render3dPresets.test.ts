// The 3D render choices: the house styles plus one library preset, Air. A saved "My 3D preset"
// or a saved view that names a preset the interface no longer offers still opens, on a house
// style; one that names Air keeps it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AIR_PRESET,
  DEFAULT_RENDER3D,
  FALLBACK_STYLE,
  RENDER_STYLES,
  migrateRender3d,
  type Render3dSettings,
} from '@/components/cbct/render3d';

const saved = (style: string, threshold = 123): Render3dSettings => ({ ...DEFAULT_RENDER3D, style, threshold });

describe('the 3D render choices', () => {
  it('the fallback is a house style', () => {
    expect(RENDER_STYLES[FALLBACK_STYLE]).toBeDefined();
  });

  it('a saved setting naming a dropped CT preset opens on the fallback house style', () => {
    for (const dropped of ['CT-Cardiac', 'CT-Bone', 'CT-Bones', 'CT-MIP', 'CT-Soft-Tissue', 'CT-Lung', 'not-a-style']) {
      const m = migrateRender3d(saved(dropped));
      expect(m.style, dropped).toBe(FALLBACK_STYLE);
      expect(m.threshold, dropped).toBe(RENDER_STYLES[FALLBACK_STYLE].defaultThreshold);
    }
  });

  it('a saved setting naming Air or a house style keeps it', () => {
    expect(migrateRender3d(saved(AIR_PRESET)).style).toBe(AIR_PRESET);
    for (const style of Object.keys(RENDER_STYLES)) {
      const m = migrateRender3d(saved(style, 321));
      expect(m.style).toBe(style);
      expect(m.threshold).toBe(321);
    }
  });

  it('legacy style keys still map to their renamed house styles', () => {
    expect(migrateRender3d(saved('style:matte')).style).toBe('style:shaded');
  });

  it('the interface offers no generic CT preset list, only the Air chip', () => {
    const app = readFileSync(path.join(process.cwd(), 'components/cbct/CbctApp.tsx'), 'utf8');
    expect(app).not.toContain('VIEWPORT_PRESETS');
    expect(app).not.toContain('VTK medical');
    expect(app).toContain('pickStyle(AIR_PRESET)');
  });
});
