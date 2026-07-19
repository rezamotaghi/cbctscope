// SERVER-ONLY. Pure pixel normalization for 2D radiographs (PX/DX/CR/IO single-frame files).
//
// Radiograph gray values carry no HU meaning and arrive on wildly different scales
// (12-bit detectors, 16-bit exports, occasional rescale tags, MONOCHROME1 vs 2). To keep
// the browser contract identical to volumes (Int16 buffer + a default window), every
// radiograph is normalized here to one documented display scale:
//   0 .. XRAY_MAX (12-bit), MONOCHROME2 semantics (bright = radiopaque).
// Windowing, gamma, and invert then behave exactly like they do on volumes.

/** Fixed display scale for normalized radiographs (12-bit). */
export const XRAY_MAX = 4095;

export interface RadiographFrameOpts {
  /** RescaleSlope (rarely present on radiographs; 1 when absent) */
  slope: number;
  /** RescaleIntercept (0 when absent) */
  intercept: number;
  /** PhotometricInterpretation === 'MONOCHROME1' (low value = white) */
  monochrome1: boolean;
}

/**
 * Normalize one raw radiograph frame to Int16 on the 0..XRAY_MAX scale.
 * Linear min-max stretch: the full detector range maps onto the display scale, and the
 * robust default window (computed downstream) picks the useful part. MONOCHROME1 input is
 * flipped so the output is always MONOCHROME2 (bright = radiopaque).
 */
export function normalizeRadiographFrame(
  px: Int16Array | Uint16Array,
  { slope, intercept, monochrome1 }: RadiographFrameOpts,
): Int16Array {
  const out = new Int16Array(px.length);
  if (px.length === 0) return out;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < px.length; i++) {
    const v = px[i] * slope + intercept;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range <= 0) return out; // constant image → all zeros, nothing to stretch
  const scale = XRAY_MAX / range;
  for (let i = 0; i < px.length; i++) {
    const t = Math.round((px[i] * slope + intercept - min) * scale);
    out[i] = monochrome1 ? XRAY_MAX - t : t;
  }
  return out;
}
