// The agent channel each surface mounts (docs/web-build.md, sections 4 and 12):
//   - the repo: sseTransport onto the Next.js bridge;
//   - the desktop app: the same sseTransport onto the shell's bridge host (desktop/bridge.mjs),
//     wrapped so the page also answers the two catalog reads the MCP server makes
//     (`source.list`, `source.meta`): in the shell the catalog lives in this tab, not in a
//     server. Both are geometry and labels only, the same data /api/cbct returns in the repo;
//   - the web build in a plain browser: nothing (milestone 3 adds the in-page agent).
import { sseTransport, type AgentCommand, type AgentTransport } from './agentTransport';
import { AGENT_AVAILABLE, IS_DESKTOP, IS_WEB } from './shell';
import { source } from './source';

const fail = (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) });

async function answerSource(cmd: AgentCommand) {
  try {
    if (cmd.verb === 'source.list') return { ok: true, result: { volumes: await source.list() } };
    return { ok: true, result: await source.meta(String(cmd.args.id ?? '')) };
  } catch (err) {
    return fail(err);
  }
}

export const desktopTransport: AgentTransport = {
  subscribe(onCommand, onEvicted) {
    return sseTransport.subscribe((cmd) => {
      if (cmd.verb === 'source.list' || cmd.verb === 'source.meta') {
        void answerSource(cmd).then((outcome) => sseTransport.reply(cmd.id, outcome));
        return;
      }
      onCommand(cmd);
    }, onEvicted);
  },
  reply: (id, outcome) => sseTransport.reply(id, outcome),
};

export const agentTransport: AgentTransport | null =
  IS_WEB && IS_DESKTOP ? desktopTransport : AGENT_AVAILABLE ? sseTransport : null;
