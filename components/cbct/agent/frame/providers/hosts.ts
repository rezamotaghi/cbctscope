// The only off-origin addresses the agent frame requests besides the clinician's own loopback
// endpoint: the three cloud providers' API bases. They live in the frame's code only
// (components/cbct/agent/frame/), which runs in the sandboxed agent-frame.html with its own
// Content Security Policy (components/webCsp.mjs AGENT_FRAME_CSP_DIRECTIVES lists the same
// hosts); the viewer's page keeps connect-src 'self'. tests/noAbsoluteUrls.test.ts allows
// these literals in this file and nowhere else. Nothing here is contacted until the clinician
// switches the agent on.
//
// Sources, read 04/11/26: Anthropic Messages API (platform.claude.com docs, the claude-api
// reference); OpenAI Responses API (developers.openai.com API reference); Gemini
// generateContent (ai.google.dev Gemini API docs).

export const ANTHROPIC_BASE = 'https://api.anthropic.com';
export const OPENAI_BASE = 'https://api.openai.com';
export const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
