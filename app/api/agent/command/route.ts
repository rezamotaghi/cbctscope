// POST /api/agent/command — entry point for the MCP server (or any local automation):
// { verb, args } is forwarded to the connected viewer UI and the result awaited.
//
// Verbs are navigation/visualization only; the viewer rejects anything it doesn't know.
import { NextRequest, NextResponse } from 'next/server';
import { dispatchCommand, hasViewer } from '@/lib/server/agentBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { verb?: string; args?: Record<string, unknown>; timeoutMs?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }
  if (typeof body.verb !== 'string') {
    return NextResponse.json({ ok: false, error: 'verb required' }, { status: 400 });
  }
  const outcome = await dispatchCommand(
    body.verb,
    body.args ?? {},
    Math.min(60_000, Math.max(1_000, Number(body.timeoutMs) || 15_000)),
  );
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 });
}

// GET → is a viewer connected?
export async function GET() {
  return NextResponse.json({ viewer: hasViewer() });
}
