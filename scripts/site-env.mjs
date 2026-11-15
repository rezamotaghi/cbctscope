// The environment of the site's build (`node scripts/build-web.mjs --site`, the first half of
// `npm run build:vercel`; docs/web-build.md, section 9). Vercel builds every push, preview and
// production alike, and a page must not differ between the two, so the build sees none of the
// variables Vercel sets: Next 15 reads VERCEL_ENV, VERCEL_URL, VERCEL_BRANCH_URL and
// VERCEL_PROJECT_PRODUCTION_URL while it renders metadata (the social-image base and the
// manifest link's crossorigin in a preview), and anything named NEXT_PUBLIC_ would be inlined.
// The rest is fixed: the root of the domain (no base path), the default size notice, Next's
// telemetry off.

/** variables the site's build never sees */
export const STRIPPED = /^(VERCEL|NEXT_PUBLIC_VERCEL|NOW_)/;

/** variables the site's build always sees, with these values */
export const SITE_ENV = Object.freeze({ NEXT_PUBLIC_BASE_PATH: '', NEXT_TELEMETRY_DISABLED: '1' });

/** variables of the other web builds that the site's build drops */
const OTHER_BUILDS = ['CBCTSCOPE_OUT_DIR', 'NEXT_PUBLIC_CBCTSCOPE_SIZE_NOTICE_MIB'];

/**
 * The environment the site's build runs with, from the one it was started in.
 * @param {Record<string, string | undefined>} env
 */
export function siteBuildEnv(env) {
  /** @type {Record<string, string | undefined>} */
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (!STRIPPED.test(k) && !OTHER_BUILDS.includes(k)) out[k] = v;
  }
  return { ...out, ...SITE_ENV };
}
