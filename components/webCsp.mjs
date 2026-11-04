// The Content Security Policy of the web build (docs/web-build.md, section 2). GitHub Pages
// sends no custom headers, so the policy rides in a meta tag that scripts/build-web.mjs writes
// into every exported page, first in <head> after the charset, so it governs every script.
// connect-src is the network half of "nothing leaves the tab": the page may fetch its own
// origin and, for the opt-in in-page agent only (docs/web-build.md, section 10, item 3), the
// three model providers' API hosts and a model server on this machine's loopback. Nothing is
// sent there until the clinician switches the agent on (tests/e2e/web.spec.ts fails on any
// off-origin request). The list matches components/cbct/agent/providers/hosts.ts;
// tests/webShell.test.ts pins it to exactly these sources.
//
// Why the build script and not app/layout.tsx: Next's exported pages carry inline bootstrap
// scripts whose content embeds the rendered tree, so their hashes cannot appear in that tree;
// and a meta tag rendered by React is matched by its attributes on hydration, so a hashed copy
// in the file makes React insert a second, hash-less policy. Written after the export, the tag
// is outside React's tree and carries the hashes.
//
// script-src: 'self' for the bundle, 'wasm-unsafe-eval' for the Cornerstone codecs, plus one
// 'sha256-...' per inline script of the page. No 'unsafe-inline' for scripts. style-src keeps
// 'unsafe-inline' for React's style attributes.
// Plain JavaScript so the build script (Node, no TypeScript step) and the app share one module.

/** @type {Record<string, string[]>} */
export const WEB_CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'connect-src': [
    "'self'",
    'https://api.anthropic.com',
    'https://api.openai.com',
    'https://generativelanguage.googleapis.com',
    'http://127.0.0.1:*',
    'http://localhost:*',
  ],
  'img-src': ["'self'", 'blob:', 'data:'],
  'worker-src': ["'self'", 'blob:'],
  'style-src': ["'self'", "'unsafe-inline'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"],
};

/**
 * The policy string, with extra script-src sources (the inline-script hashes) appended.
 * @param {string[]} [scriptSources]
 * @returns {string}
 */
export function webCsp(scriptSources = []) {
  return Object.entries(WEB_CSP_DIRECTIVES)
    .map(([k, v]) => `${k} ${(k === 'script-src' ? [...v, ...scriptSources] : v).join(' ')}`)
    .join('; ');
}

/** the policy without hashes */
export const WEB_CSP = webCsp();
