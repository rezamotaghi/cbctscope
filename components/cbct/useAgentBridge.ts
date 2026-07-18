'use client';
// Agent bridge (client half): subscribes to /api/agent/events and executes navigation and
// visualization commands against the live app state. Every verb moves the camera or reads
// pixels; none produces findings — the human reads the images.
import { useEffect, useRef } from 'react';

export interface AgentHandlers {
  /** current app state summary (volume, view mode, window) */
  getState: () => Record<string, unknown>;
  selectVolume: (id: string) => string | null; // error message or null
  setViewMode: (mode: string) => string | null;
  setWindow: (patch: { center?: number; width?: number; preset?: string; invert?: boolean }) => string | null;
  resetView: (full: boolean) => string | null;
}

interface AgentCommand {
  id: string;
  verb: string;
  args: Record<string, unknown>;
}

/** Ask CbctViewport (MPR mode) to change slice; resolves false if nobody listens. */
function navigateSlice(args: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const detail = {
      ...args,
      reply: (ok: boolean, error?: string) => resolve({ ok, error }),
    };
    const ev = new CustomEvent('cbctscope-agent-nav', { detail, cancelable: true });
    window.dispatchEvent(ev);
    // no listener consumed it (not in MPR mode / viewport not mounted)
    setTimeout(() => resolve({ ok: false, error: 'slice navigation is available in MPR mode only' }), 500);
  });
}

/** Compose every visible canvas in the main viewing area into one PNG data URL. */
async function captureSnapshot(): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const main = document.querySelector('main');
  if (!main) return { ok: false, error: 'viewer not mounted' };
  const laidOut = [...main.querySelectorAll('canvas')].filter((c) => {
    const r = c.getBoundingClientRect();
    return r.width > 10 && r.height > 10 && c.width > 0 && c.height > 0;
  });
  const out = document.createElement('canvas');
  const ctx0 = () => {
    const ctx = out.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, out.width, out.height);
    }
    return ctx;
  };
  if (laidOut.length) {
    // normal path: reproduce the on-screen layout
    const mainRect = main.getBoundingClientRect();
    const scale = 1.5; // capture above CSS resolution for readable detail
    out.width = Math.round(mainRect.width * scale);
    out.height = Math.round(mainRect.height * scale);
    const ctx = ctx0();
    if (!ctx) return { ok: false, error: 'canvas 2d unavailable' };
    for (const c of laidOut) {
      const r = c.getBoundingClientRect();
      try {
        ctx.drawImage(
          c,
          (r.left - mainRect.left) * scale,
          (r.top - mainRect.top) * scale,
          r.width * scale,
          r.height * scale,
        );
      } catch {
        /* a tainted/webgl edge case — skip that pane rather than fail the shot */
      }
    }
  } else {
    // fallback: layout not measurable (mid-reflow) — tile canvases with real backing stores
    const backed = [...main.querySelectorAll('canvas')].filter((c) => c.width > 50 && c.height > 50);
    if (!backed.length) return { ok: false, error: 'nothing rendered yet' };
    const cols = backed.length > 1 ? 2 : 1;
    const rows = Math.ceil(backed.length / cols);
    const tw = Math.max(...backed.map((c) => c.width));
    const th = Math.max(...backed.map((c) => c.height));
    out.width = cols * tw + (cols - 1) * 4;
    out.height = rows * th + (rows - 1) * 4;
    const ctx = ctx0();
    if (!ctx) return { ok: false, error: 'canvas 2d unavailable' };
    backed.forEach((c, i) => {
      try {
        ctx.drawImage(c, (i % cols) * (tw + 4), Math.floor(i / cols) * (th + 4));
      } catch {
        /* skip */
      }
    });
  }
  try {
    const dataUrl = out.toDataURL('image/png');
    return { ok: true, result: { pngBase64: dataUrl.slice('data:image/png;base64,'.length) } };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function useAgentBridge(handlers: AgentHandlers) {
  // latest-handlers ref so the SSE subscription is set up exactly once
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const es = new EventSource('/api/agent/events');
    es.onmessage = async (msg) => {
      let cmd: AgentCommand;
      try {
        cmd = JSON.parse(msg.data);
      } catch {
        return;
      }
      let ok = true;
      let result: unknown;
      let error: string | undefined;
      const h = ref.current;
      // after a state-mutating verb, let React commit before reading state back
      const settled = () =>
        new Promise<void>((r) => setTimeout(r, 60)).then(() => ref.current.getState());
      try {
        switch (cmd.verb) {
          case 'get_state':
            result = h.getState();
            break;
          case 'select_volume': {
            const err = h.selectVolume(String(cmd.args.id ?? ''));
            if (err) throw new Error(err);
            result = await settled();
            break;
          }
          case 'set_view_mode': {
            const err = h.setViewMode(String(cmd.args.mode ?? ''));
            if (err) throw new Error(err);
            result = await settled();
            break;
          }
          case 'set_window_level': {
            const err = h.setWindow(cmd.args as { center?: number; width?: number; preset?: string; invert?: boolean });
            if (err) throw new Error(err);
            result = await settled();
            break;
          }
          case 'navigate_slice': {
            const nav = await navigateSlice(cmd.args);
            if (!nav.ok) throw new Error(nav.error ?? 'navigation failed');
            result = await settled();
            break;
          }
          case 'reset_view': {
            const err = h.resetView(cmd.args.full === true);
            if (err) throw new Error(err);
            result = await settled();
            break;
          }
          case 'snapshot': {
            // let the current frame settle before reading pixels
            await new Promise((r) => setTimeout(r, 150));
            const shot = await captureSnapshot();
            if (!shot.ok) throw new Error(shot.error ?? 'snapshot failed');
            result = shot.result;
            break;
          }
          default:
            throw new Error(`unknown verb: ${cmd.verb}`);
        }
      } catch (e) {
        ok = false;
        error = e instanceof Error ? e.message : String(e);
      }
      try {
        await fetch('/api/agent/result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: cmd.id, ok, result, error }),
        });
      } catch {
        /* server gone — nothing to report to */
      }
    };
    return () => es.close();
  }, []);
}
