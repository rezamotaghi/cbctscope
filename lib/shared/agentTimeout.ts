// SHARED. How long a dispatched agent command waits for the viewer, by default: the server's
// bus (lib/server/agentBus.ts), the desktop bridge (desktop/bridge.mjs, the same number) and
// the in-page agent's page transport (components/cbct/agentTransport.ts) use one figure.
export const AGENT_TIMEOUT_MS = 15_000;
