// The agent channel (docs/web-build.md, section 4). useAgentBridge executes the verbs; the
// transport only carries commands in and outcomes back.
//   - sseTransport: the repo's loopback bridge (the SSE command stream plus the result POST).
//   - createPageTransport: an in-memory queue inside the tab, for callers in the same page
//     (the in-page agent of milestone 3, the desktop shell's bridge host of milestone 2).
// agentChannel.ts merges the page transport with the surface's loopback channel (if any).

export interface AgentCommand {
  id: string;
  verb: string;
  args: Record<string, unknown>;
}

export interface AgentOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface AgentTransport {
  /** start delivering commands; returns the unsubscribe */
  subscribe(onCommand: (cmd: AgentCommand) => void, onEvicted: () => void): () => void;
  reply(id: string, outcome: AgentOutcome): Promise<void>;
}

export const sseTransport: AgentTransport = {
  subscribe(onCommand, onEvicted) {
    // dead = this subscription was cleaned up (unmount, or StrictMode's throwaway first
    // mount). A late 'evicted' for a dead subscription must not flag the banner: the
    // eviction came from this same tab's own replacement subscription, not a rival tab.
    let dead = false;
    const es = new EventSource('/api/agent/events');
    // a newer tab subscribed: this tab is no longer the viewer. Stop listening for good
    // (no auto-reconnect, which would evict the newer tab right back).
    es.addEventListener('evicted', () => {
      es.close();
      if (!dead) onEvicted();
    });
    es.onmessage = (msg) => {
      let cmd: AgentCommand;
      try {
        cmd = JSON.parse(msg.data);
      } catch {
        return;
      }
      onCommand(cmd);
    };
    return () => {
      dead = true;
      es.close();
    };
  },
  async reply(id, outcome) {
    try {
      await fetch('/api/agent/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ok: outcome.ok, result: outcome.result, error: outcome.error }),
      });
    } catch {
      /* server gone: nothing to report to */
    }
  },
};

export interface PageTransport extends AgentTransport {
  /** send one verb to the subscribed viewer and wait for its outcome */
  dispatch(verb: string, args?: Record<string, unknown>): Promise<AgentOutcome>;
}

/**
 * An in-memory transport. Commands dispatched before anyone subscribes wait in the queue and
 * are delivered on subscribe. A second subscriber takes over and the first is told it was
 * evicted, the same single-viewer contract as the loopback bridge.
 */
export function createPageTransport(): PageTransport {
  const queue: AgentCommand[] = [];
  const pending = new Map<string, (o: AgentOutcome) => void>();
  let current: { onCommand: (cmd: AgentCommand) => void; onEvicted: () => void } | null = null;
  let seq = 0;

  const drain = () => {
    while (current && queue.length) current.onCommand(queue.shift() as AgentCommand);
  };

  return {
    subscribe(onCommand, onEvicted) {
      const prev = current;
      const mine = { onCommand, onEvicted };
      current = mine;
      if (prev) prev.onEvicted();
      drain();
      return () => {
        if (current === mine) current = null;
      };
    },
    async reply(id, outcome) {
      const resolve = pending.get(id);
      if (!resolve) return;
      pending.delete(id);
      resolve(outcome);
    },
    dispatch(verb, args = {}) {
      const id = `page-${++seq}`;
      return new Promise<AgentOutcome>((resolve) => {
        pending.set(id, resolve);
        queue.push({ id, verb, args });
        drain();
      });
    },
  };
}

/** the tab's shared page transport: the in-page agent dispatches here (components/cbct/agent/) */
export const pageTransport = createPageTransport();
