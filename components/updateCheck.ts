// The update page's logic (app/update, components/UpdateStatus.tsx), pure so tests/updateCheck.test.ts
// reads it without a browser. The desktop app's menu opens the page with the installed version
// after the # sign (desktop/native.mjs updateUrl); the page compares it with the version the
// site was built with. Nothing here makes a request.
import { UPDATE_URL } from './links';

/** a strict major.minor.patch version: three dot-separated integers, nothing else */
const VERSION_RE = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;

/** the version as three numbers, or null when it is not a strict major.minor.patch */
export function parseVersion(v: string): [number, number, number] | null {
  const m = VERSION_RE.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * The installed version a page address carries: `#from=` followed by a strict version, and
 * nothing else in the fragment. Anything else counts as no version.
 */
export function versionFromHash(hash: string): string | null {
  const m = /^#from=(.*)$/.exec(hash);
  if (!m || !parseVersion(m[1])) return null;
  return m[1];
}

/** -1 when a is older than b, 0 when equal, 1 when newer; numeric per part, so 2.10.0 is newer than 2.9.0 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`compareVersions: ${!pa ? a : b} is not a major.minor.patch version`);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export type UpdateVerdict =
  | { kind: 'older' | 'same' | 'newer'; installed: string; newest: string }
  | { kind: 'unknown'; newest: string };

/**
 * What the page says, from the installed version (or none) and the newest one the site knows.
 * Total: when either is not a strict major.minor.patch, the page says only the newest version.
 */
export function updateVerdict(installed: string | null, newest: string): UpdateVerdict {
  if (installed === null || !parseVersion(installed) || !parseVersion(newest)) return { kind: 'unknown', newest };
  const c = compareVersions(installed, newest);
  return { kind: c < 0 ? 'older' : c === 0 ? 'same' : 'newer', installed, newest };
}

/** the website's update page for an installed version, as the desktop app's menu opens it */
export function updatePageUrl(version: string): string {
  return parseVersion(version) ? `${UPDATE_URL}#from=${version}` : UPDATE_URL;
}
