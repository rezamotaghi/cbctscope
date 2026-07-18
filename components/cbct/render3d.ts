// 3D render engine for the CBCT viewer.
//
// A render STYLE = a named pair of transfer functions (opacity curve + color ramp over HU)
// plus a blend rule for the ray-march: composite (accumulate front-to-back), MIP (brightest
// voxel wins — vessels/metal pop), or average (mean along the ray = a true radiograph look).
// The ADJUST sliders reshape the style parametrically:
//   threshold    — the HU where opacity starts (curves are authored RELATIVE to it, so the
//                  whole ramp slides with the slider)
//   transparency — scales the entire opacity curve down (0 = as authored)
//   brightness   — shifts the color ramp's output up/down
//   contrast     — steepens/flattens the ramp around mid-gray
// Pseudo-color swaps the style's color ramp for a colormap over [threshold, HI_HU].
import type { RenderingEngine, Types } from '@cornerstonejs/core';

export type PseudoKey = 'none' | 'hot' | 'cool' | 'rainbow';

export interface Render3dSettings {
  /** 'style:*' / 'cbct:*' (parametric, sliders apply) or a Cornerstone CT-* preset name (as-is). */
  style: string;
  threshold: number; // HU opacity threshold
  transparency: number; // 0..90 (%)
  brightness: number; // -100..100
  contrast: number; // -100..100
  pseudo: PseudoKey;
  perspective: boolean; // false = orthographic (parallel) projection
  /** Light follows the camera (headlight, the default) or sits at a fixed direction. */
  lightFollow: boolean;
  lightAz: number; // degrees around the volume, 0 = from the front (anterior)
  lightEl: number; // degrees above (+) / below (−) the axial plane
  /** Edge emphasis 0..100: gradient opacity — flat interiors fade, edges/surfaces pop. */
  edgeEmphasis: number;
  /** Skin shell: flesh-toned translucent band below the style's threshold. */
  skinShell: boolean;
  skinShellThreshold: number; // HU where the skin band starts
  skinShellOpacity: number; // 5..80 (%) band opacity
}

export interface StyleDef {
  label: string;
  /** short functional description, shown as the picker option's tooltip */
  tip?: string;
  group: 'classic' | 'cbct';
  /** vtk BlendMode: 0 composite · 1 max-intensity · 3 average-intensity */
  blend: 0 | 1 | 3;
  defaultThreshold: number; // HU
  /** film-negative output (inverted radiograph) */
  invert?: boolean;
  opacity: (t: number) => [number, number][];
  color: (t: number) => [number, number, number, number][];
  shade?: { ambient: number; diffuse: number; specular: number; specularPower: number };
}

const HI_HU = 3200; // practical top of the CBCT HU range for ramp authoring

const gray = (t: number): [number, number, number, number][] => [
  [t, 0, 0, 0],
  [HI_HU, 1, 1, 1],
];

const boneRamp = (t: number): [number, number, number, number][] => [
  [t, 0.55, 0.35, 0.25],
  [t + 350, 0.85, 0.75, 0.6],
  [t + 900, 0.94, 0.9, 0.8],
  [Math.max(t + 1400, 2400), 1, 1, 0.98],
];

export const RENDER_STYLES: Record<string, StyleDef> = {
  // ---- parametric presets (authored relative to threshold so the slider slides the ramp)
  'style:matte': {
    label: 'Matte',
    tip: 'bone render, diffuse lighting',
    group: 'classic',
    blend: 0,
    defaultThreshold: 350,
    opacity: (t) => [[-1000, 0], [t, 0], [t + 220, 0.22], [t + 800, 0.55], [t + 1400, 0.85], [HI_HU, 0.95]],
    color: boneRamp,
    shade: { ambient: 0.25, diffuse: 0.9, specular: 0.25, specularPower: 12 },
  },
  'style:gloss': {
    label: 'Gloss',
    tip: 'bone render with specular highlights',
    group: 'classic',
    blend: 0,
    defaultThreshold: 350,
    opacity: (t) => [[-1000, 0], [t, 0], [t + 220, 0.22], [t + 800, 0.55], [t + 1400, 0.85], [HI_HU, 0.95]],
    color: boneRamp,
    shade: { ambient: 0.2, diffuse: 0.85, specular: 0.7, specularPower: 40 },
  },
  'style:shell': {
    label: 'Shell',
    tip: 'isosurface at the opacity threshold',
    group: 'classic',
    blend: 0,
    defaultThreshold: 450,
    opacity: (t) => [[-1000, 0], [t - 1, 0], [t + 80, 0.98], [HI_HU, 0.98]],
    color: (t) => [
      [t, 0.78, 0.75, 0.7],
      [HI_HU, 0.95, 0.94, 0.9],
    ],
    shade: { ambient: 0.3, diffuse: 0.9, specular: 0.4, specularPower: 20 },
  },
  'style:skin': {
    label: 'Skin',
    tip: 'flesh-toned soft-tissue surface',
    group: 'classic',
    blend: 0,
    defaultThreshold: -450,
    opacity: (t) => [[-1000, 0], [t, 0], [t + 160, 0.4], [t + 500, 0.6], [800, 0.75], [HI_HU, 0.9]],
    color: (t) => [
      [t, 0.62, 0.42, 0.32],
      [t + 300, 0.82, 0.6, 0.46],
      [400, 0.93, 0.82, 0.68],
      [2200, 1, 1, 0.95],
    ],
    shade: { ambient: 0.28, diffuse: 0.9, specular: 0.15, specularPower: 8 },
  },
  'style:mip': {
    label: 'MIP',
    tip: 'maximum intensity projection',
    group: 'classic',
    blend: 1,
    defaultThreshold: 0,
    // opacity is a step: it only gates WHICH maxima show; the gray ramp carries the signal
    // (a linear opacity here would double-darken mid-density maxima)
    opacity: (t) => [[t, 0], [t + 1, 1], [HI_HU, 1]],
    color: gray,
  },
  'style:radiograph': {
    label: 'Radiograph',
    tip: 'average-intensity projection, a DRR',
    group: 'classic',
    blend: 3,
    defaultThreshold: -300,
    // average blend: the ray MEAN is mostly soft-tissue HU, so the gray window must be much
    // narrower than the full range or everything renders near-black; opacity is a step gate
    opacity: (t) => [[t, 0], [t + 1, 1], [HI_HU, 1]],
    color: (t) => [
      [t, 0, 0, 0],
      [t + 1400, 1, 1, 1],
    ],
  },
  'style:glass': {
    label: 'Glass',
    tip: 'translucent shaded volume',
    group: 'classic',
    blend: 0,
    defaultThreshold: 100,
    opacity: (t) => [[-1000, 0], [t, 0], [t + 300, 0.08], [t + 1200, 0.22], [HI_HU, 0.5]],
    color: gray,
    shade: { ambient: 0.3, diffuse: 0.85, specular: 0.3, specularPower: 15 },
  },
  'style:film': {
    label: 'Film',
    tip: 'inverted radiograph, film look',
    group: 'classic',
    blend: 3,
    defaultThreshold: -300,
    invert: true,
    opacity: (t) => [[t, 0], [t + 1, 1], [HI_HU, 1]],
    color: (t) => [
      [t, 0, 0, 0],
      [t + 1400, 1, 1, 1],
    ],
  },
  // ---- CBCT hand-tuned favorites (threshold slides them)
  'cbct:bone-teeth': {
    label: 'CBCT · bone + teeth',
    group: 'cbct',
    blend: 0,
    defaultThreshold: 150,
    opacity: (t) => [[-1000, 0], [t, 0], [t + 250, 0.12], [t + 950, 0.4], [t + 1650, 0.75], [HI_HU, 0.95]],
    color: boneRamp,
    shade: { ambient: 0.25, diffuse: 0.9, specular: 0.3, specularPower: 15 },
  },
  'cbct:teeth': {
    label: 'CBCT · teeth (high density)',
    group: 'cbct',
    blend: 0,
    defaultThreshold: 1000,
    opacity: (t) => [[-1000, 0], [t, 0], [t + 400, 0.45], [t + 1200, 0.9], [HI_HU, 0.98]],
    color: (t) => [
      [t + 100, 0.9, 0.85, 0.72],
      [t + 800, 0.97, 0.95, 0.88],
      [Math.max(t + 1600, 2600), 1, 1, 1],
    ],
    shade: { ambient: 0.25, diffuse: 0.9, specular: 0.3, specularPower: 15 },
  },
  'cbct:translucent': {
    label: 'CBCT · translucent bone, solid teeth',
    group: 'cbct',
    blend: 0,
    defaultThreshold: 250,
    opacity: (t) => [[-1000, 0], [t, 0], [t + 450, 0.08], [t + 950, 0.16], [t + 1400, 0.7], [HI_HU, 0.95]],
    color: (t) => [
      [t + 50, 0.6, 0.45, 0.35],
      [t + 650, 0.88, 0.8, 0.68],
      [t + 1450, 0.96, 0.94, 0.86],
      [Math.max(t + 2350, 2600), 1, 1, 1],
    ],
    shade: { ambient: 0.25, diffuse: 0.9, specular: 0.3, specularPower: 15 },
  },
};

export const DEFAULT_RENDER3D: Render3dSettings = {
  style: 'cbct:bone-teeth',
  threshold: RENDER_STYLES['cbct:bone-teeth'].defaultThreshold,
  transparency: 0,
  brightness: 0,
  contrast: 0,
  pseudo: 'none',
  perspective: false,
  lightFollow: true,
  lightAz: 40,
  lightEl: 30,
  edgeEmphasis: 0,
  skinShell: false,
  skinShellThreshold: -450,
  skinShellOpacity: 30,
};

// Colormaps for pseudo-color, as f∈[0,1] over [threshold, HI_HU].
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const PSEUDO_MAPS: Record<Exclude<PseudoKey, 'none'>, (f: number) => [number, number, number]> = {
  hot: (f) => [clamp01(f * 3), clamp01(f * 3 - 1), clamp01(f * 3 - 2)],
  cool: (f) => [clamp01(f), clamp01(1 - f * 0.4), 1],
  rainbow: (f) => {
    // HSV hue sweep blue→red
    const h = (1 - f) * 240;
    const c = 1;
    const x = 1 - Math.abs(((h / 60) % 2) - 1);
    if (h < 60) return [c, x, 0];
    if (h < 120) return [x, c, 0];
    if (h < 180) return [0, c, x];
    return [0, x, c];
  },
};

interface VtkColorFn {
  removeAllPoints: () => void;
  addRGBPoint: (v: number, r: number, g: number, b: number) => void;
}
interface VtkOpacityFn {
  removeAllPoints: () => void;
  addPoint: (v: number, o: number) => void;
}
interface Vtk3dProperty {
  getRGBTransferFunction: (i: number) => VtkColorFn;
  getScalarOpacity: (i: number) => VtkOpacityFn;
  setShade: (v: boolean) => void;
  setAmbient: (v: number) => void;
  setDiffuse: (v: number) => void;
  setSpecular: (v: number) => void;
  setSpecularPower: (v: number) => void;
  setIpScalarRange?: (min: number, max: number) => void;
  setUseGradientOpacity?: (i: number, v: boolean) => void;
  setGradientOpacityMinimumValue?: (i: number, v: number) => void;
  setGradientOpacityMinimumOpacity?: (i: number, v: number) => void;
  setGradientOpacityMaximumValue?: (i: number, v: number) => void;
  setGradientOpacityMaximumOpacity?: (i: number, v: number) => void;
}
interface Vtk3dActor {
  getProperty: () => Vtk3dProperty;
  getMapper: () => { setBlendMode?: (m: number) => void };
  getBounds: () => number[];
}

/** brightness/contrast on a 0..1 channel value: steepen around mid-gray, then shift. */
function bc(v: number, brightness: number, contrast: number): number {
  const k = 1 + contrast / 100; // -100..100 → 0..2
  return clamp01((v - 0.5) * k + 0.5 + brightness / 200);
}

/**
 * Apply the full settings object to the 3D viewport's volume actor. Parametric styles get
 * blend + reshaped transfer functions + shading; unknown keys fall through to Cornerstone's
 * named CT-* presets (as-is — the sliders don't apply to those).
 */
export function apply3dRender(engine: RenderingEngine, viewportId: string, s: Render3dSettings) {
  const vp = engine.getViewport(viewportId) as Types.IVolumeViewport;
  const def = RENDER_STYLES[s.style];
  if (!def) {
    vp.setProperties({ preset: s.style });
    vp.render();
    return;
  }
  const actor = vp.getDefaultActor()?.actor as unknown as Vtk3dActor | undefined;
  const prop = actor?.getProperty?.();
  if (!actor || !prop) return;

  const t = s.threshold;
  actor.getMapper()?.setBlendMode?.(def.blend);
  // average blend: only samples inside this HU band count toward the ray mean
  if (def.blend === 3) prop.setIpScalarRange?.(t, 4000);

  // the skin shell only makes sense when the band sits BELOW the style's own start
  const shellOn = s.skinShell && def.blend === 0 && s.skinShellThreshold < t - 60;
  const shellO = clamp01(s.skinShellOpacity / 100);

  const oScale = 1 - s.transparency / 100;
  const ofun = prop.getScalarOpacity(0);
  ofun.removeAllPoints();
  if (shellOn) {
    // flesh-toned translucent shell under the style's threshold, then hand over to the style
    ofun.addPoint(-1000, 0);
    ofun.addPoint(s.skinShellThreshold, 0);
    ofun.addPoint(s.skinShellThreshold + 80, clamp01(shellO * oScale));
    ofun.addPoint(t - 30, clamp01(shellO * oScale));
    for (const [hu, o] of def.opacity(t)) {
      if (hu < t) continue; // the style's sub-threshold zeros would notch the band out
      ofun.addPoint(hu, clamp01(Math.max(o, hu <= t + 1 ? shellO * 0.5 : 0) * oScale));
    }
  } else {
    for (const [hu, o] of def.opacity(t)) ofun.addPoint(hu, clamp01(o * oScale));
  }

  const ctf = prop.getRGBTransferFunction(0);
  ctf.removeAllPoints();
  if (shellOn) {
    // skin tones for the band (kept OUTSIDE brightness/contrast so the shell stays stable)
    ctf.addRGBPoint(s.skinShellThreshold, 0.62, 0.4, 0.31);
    ctf.addRGBPoint(t - 31, 0.88, 0.66, 0.52);
  }
  if (s.pseudo !== 'none') {
    const map = PSEUDO_MAPS[s.pseudo];
    const STEPS = 24;
    for (let i = 0; i <= STEPS; i++) {
      const f = i / STEPS;
      let [r, g, b] = map(f);
      r = bc(r, s.brightness, s.contrast);
      g = bc(g, s.brightness, s.contrast);
      b = bc(b, s.brightness, s.contrast);
      if (def.invert) [r, g, b] = [1 - r, 1 - g, 1 - b];
      ctf.addRGBPoint(t + f * (HI_HU - t), r, g, b);
    }
  } else {
    for (const [hu, r0, g0, b0] of def.color(t)) {
      if (shellOn && hu < t - 30) continue; // the band owns the colors below the threshold
      let r = bc(r0, s.brightness, s.contrast);
      let g = bc(g0, s.brightness, s.contrast);
      let b = bc(b0, s.brightness, s.contrast);
      if (def.invert) [r, g, b] = [1 - r, 1 - g, 1 - b];
      ctf.addRGBPoint(hu, r, g, b);
    }
  }

  // edge emphasis = gradient opacity: opacity additionally scales with the local density
  // GRADIENT, so homogeneous interiors fade and edges/surfaces pop. Slider maps to how steep
  // a gradient is needed for full opacity.
  if (s.edgeEmphasis > 0 && def.blend === 0) {
    prop.setUseGradientOpacity?.(0, true);
    prop.setGradientOpacityMinimumValue?.(0, 1);
    prop.setGradientOpacityMinimumOpacity?.(0, clamp01(1 - s.edgeEmphasis / 100));
    prop.setGradientOpacityMaximumValue?.(0, 40 + (s.edgeEmphasis / 100) * 400);
    prop.setGradientOpacityMaximumOpacity?.(0, 1);
  } else {
    prop.setUseGradientOpacity?.(0, false);
  }

  if (def.shade) {
    prop.setShade(true);
    prop.setAmbient(def.shade.ambient);
    prop.setDiffuse(def.shade.diffuse);
    prop.setSpecular(def.shade.specular);
    prop.setSpecularPower(def.shade.specularPower);
  } else {
    prop.setShade(false);
  }
  applyLighting(vp, actor, s);
  vp.render();
}

interface VtkLight {
  setLightTypeToHeadLight: () => void;
  setLightTypeToSceneLight: () => void;
  setPosition: (x: number, y: number, z: number) => void;
  setFocalPoint: (x: number, y: number, z: number) => void;
}

// Light direction for the shaded styles. Default = headlight (rides the camera, vtk's own
// default). Fixed mode parks the light on a sphere around the volume: azimuth walks around
// the patient (0 = from the front), elevation tilts above/below the axial plane.
function applyLighting(vp: unknown, actor: Vtk3dActor, s: Render3dSettings) {
  try {
    const renderer = (vp as { getRenderer: () => { getLights: () => VtkLight[] } }).getRenderer();
    const light = renderer.getLights()[0];
    if (!light) return;
    if (s.lightFollow) {
      light.setLightTypeToHeadLight();
      return;
    }
    const b = actor.getBounds();
    const c = [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, (b[4] + b[5]) / 2];
    const dist = Math.hypot(b[1] - b[0], b[3] - b[2], b[5] - b[4]) * 1.5;
    const az = (s.lightAz * Math.PI) / 180;
    const el = (s.lightEl * Math.PI) / 180;
    // LPS: +x = patient left, +y = posterior, +z = superior; az 0 = light from anterior
    const dir = [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
    light.setLightTypeToSceneLight();
    light.setPosition(c[0] + dir[0] * dist, c[1] + dir[1] * dist, c[2] + dir[2] * dist);
    light.setFocalPoint(c[0], c[1], c[2]);
  } catch {
    /* lighting is cosmetic — never block the render */
  }
}

interface VtkCamera {
  getParallelProjection: () => boolean;
  setParallelProjection: (v: boolean) => void;
  setViewAngle: (deg: number) => void;
}

/**
 * Orthographic (parallel) vs perspective projection for the 3D view. Switching the projection
 * model changes what "zoom" means, so the camera is re-fit — orbit position resets to home.
 * NOTE: the re-fit must be the vtk renderer's own resetCamera — Cornerstone's re-fits by
 * parallel scale and leaves a perspective camera so far out the volume renders as a dot.
 */
export function applyProjection(
  engine: RenderingEngine,
  viewportId: string,
  perspective: boolean,
  opts?: { force?: boolean },
) {
  const vp = engine.getViewport(viewportId);
  const renderer = (
    vp as unknown as {
      getRenderer: () => { getActiveCamera: () => VtkCamera; resetCamera: () => void };
    }
  ).getRenderer();
  const cam = renderer.getActiveCamera();
  // force = re-fit even when the projection model is already right — needed after a volume
  // attach or a camera reset, where the fit was computed for the WRONG model (the effect can
  // flip the camera to perspective before any volume exists, so its first fit is empty-bounds)
  if (!opts?.force && cam.getParallelProjection() === !perspective) return;
  cam.setParallelProjection(!perspective);
  if (perspective) {
    cam.setViewAngle(30);
    renderer.resetCamera(); // vtk-level fit: positions by bounds + view angle
  } else {
    vp.resetCamera(); // Cornerstone's parallel-scale fit is the right one for orthographic
  }
  vp.render();
}
