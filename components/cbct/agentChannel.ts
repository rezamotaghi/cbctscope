// The agent channel each surface mounts (docs/web-build.md, sections 4 and 12):
//   - the repo: sseTransport onto the Next.js bridge;
//   - the desktop app: the same sseTransport onto the shell's bridge host (desktop/bridge.mjs),
//     wrapped so the page also answers the two catalog reads the MCP server makes
//     (`source.list`, `source.meta`): in the shell the catalog lives in this tab, not in a
//     server. Both are geometry and labels only, the same data /api/cbct returns in the repo;
//   - the web build in a plain browser: no loopback channel.
// On every surface the page transport rides along, so the in-page agent of milestone 3
// (components/cbct/agent/) reaches the same verb switch: withPageAgent merges the two, and
// replies go back to whichever channel the command came in on.
import { pageTransport, sseTransport, type AgentCommand, type AgentTransport, type PageTransport } from './agentTransport';
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

/** the loopback channel of this surface, or null in a plain browser */
export const loopbackTransport: AgentTransport | null =
  IS_WEB && IS_DESKTOP ? desktopTransport : AGENT_AVAILABLE ? sseTransport : null;

/**
 * One transport over the page queue and the loopback channel (when there is one). Page
 * command ids start with `page-` (createPageTransport), so a reply finds its way back.
 * Eviction is the loopback channel's alone: the page queue has one subscriber, this hook.
 */
export function withPageAgent(page: PageTransport, loopback: AgentTransport | null): AgentTransport {
  const isPage = new Set<string>();
  return {
    subscribe(onCommand, onEvicted) {
      const offPage = page.subscribe(
        (cmd) => {
          isPage.add(cmd.id);
          onCommand(cmd);
        },
        () => {},
      );
      const offLoop = loopback ? loopback.subscribe(onCommand, onEvicted) : () => {};
      return () => {
        offPage();
        offLoop();
      };
    },
    reply(id, outcome) {
      if (isPage.delete(id)) return page.reply(id, outcome);
      return loopback ? loopback.reply(id, outcome) : Promise.resolve();
    },
  };
}

/** what useAgentBridge listens on: the in-page agent's queue plus this surface's loopback channel */
export const agentTransport: AgentTransport = withPageAgent(pageTransport, loopbackTransport);
