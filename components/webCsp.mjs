// The Content Security Policy of the web build (docs/web-build.md, section 2). The same files
// serve the website and the desktop app, so the policy rides in the files: a meta tag that
// scripts/build-web.mjs writes into every exported page, first in <head> after the charset, so it governs every script.
// connect-src is the network half of "nothing leaves the tab": the viewer's page may fetch its
// own origin and nothing else. The opt-in in-page agent's provider calls run in a separate
// static page, agent-frame.html (scripts/agent-frame.mjs), loaded in an
// <iframe sandbox="allow-scripts">: its own policy (AGENT_FRAME_CSP_DIRECTIVES below) is the
// only one that names the three provider API hosts and loopback, and frame-src 'self' lets the
// viewer load it. tests/webShell.test.ts pins both policies to exactly these sources.
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
  'connect-src': ["'self'"],
  'frame-src': ["'self'"],
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

/**
 * The agent frame's policy (agent-frame.html): nothing by default; its one inline script by
 * hash; the three provider API hosts (components/cbct/agent/frame/providers/hosts.ts) and a
 * model server on loopback as the only connections; no frames, forms, plugins or base URL.
 * @type {Record<string, string[]>}
 */
export const AGENT_FRAME_CSP_DIRECTIVES = {
  'default-src': ["'none'"],
  'connect-src': [
    'https://api.anthropic.com',
    'https://api.openai.com',
    'https://generativelanguage.googleapis.com',
    'http://127.0.0.1:*',
    'http://localhost:*',
  ],
  'script-src': [],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-src': ["'none'"],
};

/**
 * The agent frame's policy string with its inline script's hash.
 * @param {string[]} scriptSources
 * @returns {string}
 */
export function agentFrameCsp(scriptSources) {
  return Object.entries(AGENT_FRAME_CSP_DIRECTIVES)
    .map(([k, v]) => `${k} ${(k === 'script-src' ? [...v, ...scriptSources] : v).join(' ')}`)
    .join('; ');
}
