// POST /api/agent/result — the viewer UI posts back the outcome of an agent command.
import { NextRequest, NextResponse } from 'next/server';
import { resolveCommand } from '@/lib/server/agentBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { id?: string; ok?: boolean; result?: unknown; error?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 });
  const known = resolveCommand(body.id, body.ok !== false, body.result, body.error);
  return NextResponse.json({ ok: true, known });
}
