// GET /api/agent/events — SSE stream of agent commands to the viewer UI. The browser
// subscribes once on app start; each event is one JSON-encoded AgentCommand.
import { NextRequest } from 'next/server';
import { subscribe } from '@/lib/server/agentBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* stream already closed */
        }
      };
      send(': connected\n\n');
      unsubscribe = subscribe((cmd) => send(`data: ${JSON.stringify(cmd)}\n\n`));
      heartbeat = setInterval(() => send(': ping\n\n'), 25_000);
      req.signal.addEventListener('abort', () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
