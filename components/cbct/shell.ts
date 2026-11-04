// Which surface the page runs in (docs/web-build.md, section 1). The web build and the
// desktop app ship the same static bundle; the desktop shell (desktop/main.mjs) appends
// `CBCTScope/<version>` to the user agent, and that token is the only difference the page sees.

/** the static web build (cbctscope.com and the packaged app): browser source, no server */
export const IS_WEB = process.env.NEXT_PUBLIC_CBCTSCOPE_TARGET === 'web';

/** inside the desktop app (false during the static export, where there is no navigator) */
export const IS_DESKTOP = typeof navigator !== 'undefined' && navigator.userAgent.includes('CBCTScope/');

/** a loopback agent bridge is there to talk to: the repo's server, or the desktop bridge host */
export const AGENT_AVAILABLE = !IS_WEB || IS_DESKTOP;
