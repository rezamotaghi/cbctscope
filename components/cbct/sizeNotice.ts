// The size notice of the web build (docs/web-build.md, section 6): before a volume whose voxel
// bytes exceed the threshold loads, the reader is told the browser must hold it in memory and
// chooses Continue or Cancel. The local app has no such limit and never asks.

export const DEFAULT_SIZE_NOTICE_MIB = 512;

/** the threshold in MiB from the build-time variable; anything unusable falls back to 512 */
export function sizeNoticeMiB(raw: string | undefined): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(n) && n > 0 ? n : DEFAULT_SIZE_NOTICE_MIB;
}

/** voxel bytes of a catalog entry: Int16, so two bytes per voxel */
export function voxelBytes(dims: [number, number, number]): number {
  return dims[0] * dims[1] * dims[2] * 2;
}

/** true when the notice must be shown before this volume loads */
export function needsSizeNotice(bytes: number, thresholdMiB: number): boolean {
  return bytes > thresholdMiB * 1024 * 1024;
}

/** "1.4 GiB" / "730 MiB" for the notice's text */
export function formatBytes(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${Math.round(mib)} MiB`;
}

/** read once at build time (NEXT_PUBLIC_ is inlined) */
export const SIZE_NOTICE_MIB = sizeNoticeMiB(process.env.NEXT_PUBLIC_CBCTSCOPE_SIZE_NOTICE_MIB);
