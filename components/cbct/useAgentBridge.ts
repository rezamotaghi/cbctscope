'use client';
// Agent bridge (client half): subscribes to /api/agent/events and executes navigation and
// visualization commands against the live app state. Every verb moves the camera, restores
// a presentation, or reads pixels; none produces findings — the human reads the images.
//
// Two channels: the App's own handlers (volume, mode, window, 3D style) and window events
// answered by whichever reading-mode component is mounted (slices, arch position, saved
// views, the mode's part of the state). An event nobody consumes fails fast with a clear
// error, so a verb the current mode cannot serve never hangs.
import { useEffect, useRef } from 'react';

export interface AgentHandlers {
  /** current app state summary (volume, view mode, window, 3D style) */
  getState: () => Record<string, unknown>;
  selectVolume: (id: string) => string | null; // error message or null
  setViewMode: (mode: string) => string | null;
  setWindow: (patch: { center?: number; width?: number; preset?: string; invert?: boolean }) => string | null;
  setStyle3d: (style: string) => string | null;
  resetView: (full: boolean) => string | null;
  /** a newer viewer tab took over the agent connection (single-viewer contract) */
  onEvicted?: () => void;
}

interface AgentCommand {
  id: string;
  verb: string;
  args: Record<string, unknown>;
}

/** Reply signature every mode-side listener uses: ok, an error for the agent, data for the state. */
export type AgentReply = (ok: boolean, error?: string, data?: Record<string, unknown>) => void;

/**
 * Ask the mounted reading-mode component something over a window event
 * (`cbctscope-agent-<name>`). Resolves with its reply, or with `fallback` after 500 ms when
 * no listener consumed the event (that mode has nothing to answer).
 */
function ask(
  name: string,
  args: Record<string, unknown>,
  fallback: string,
): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  return new Promise((resolve) => {
    let done = false;
    const reply: AgentReply = (ok, error, data) => {
      if (done) return;
      done = true;
      resolve({ ok, error, data });
    };
    window.dispatchEvent(new CustomEvent(`cbctscope-agent-${name}`, { detail: { ...args, reply }, cancelable: true }));
    setTimeout(() => reply(false, fallback), 500);
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
    // dead = this effect instance was cleaned up (unmount, or StrictMode's throwaway first
    // mount). A late 'evicted' for a dead subscription must not flag the banner: the
    // eviction came from this same tab's own replacement subscription, not a rival tab.
    let dead = false;
    const es = new EventSource('/api/agent/events');
    // a newer tab subscribed: this tab is no longer the viewer — stop listening for good
    // (no auto-reconnect, which would evict the newer tab right back)
    es.addEventListener('evicted', () => {
      es.close();
      if (!dead) ref.current.onEvicted?.();
    });
    // the App's summary plus whatever the mounted mode answers (slices, grid, pano, views)
    const fullState = async () => {
      const q = await ask('query', {}, '');
      return { ...ref.current.getState(), ...(q.ok ? q.data : {}) };
    };
    // after a state-mutating verb, let React commit before reading state back
    const settled = () => new Promise<void>((r) => setTimeout(r, 120)).then(fullState);
    const must = (err: string | null) => {
      if (err) throw new Error(err);
    };
    const asked = async (name: string, args: Record<string, unknown>, fallback: string) => {
      const r = await ask(name, args, fallback);
      if (!r.ok) throw new Error(r.error ?? `${name} failed`);
      return r.data ?? {};
    };
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
      const a = cmd.args;
      try {
        switch (cmd.verb) {
          case 'get_state':
            result = await fullState();
            break;
          case 'select_volume':
            must(h.selectVolume(String(a.id ?? '')));
            result = await settled();
            break;
          case 'set_view_mode':
            must(h.setViewMode(String(a.mode ?? '')));
            result = await settled();
            break;
          case 'set_window_level':
            must(h.setWindow(a as { center?: number; width?: number; preset?: string; invert?: boolean }));
            result = await settled();
            break;
          case 'set_3d_style':
            must(h.setStyle3d(String(a.style ?? '')));
            result = await settled();
            break;
          case 'navigate_slice':
            await asked('nav', a, 'this reading mode has no slice to move (MPR, grid, and pano do)');
            result = await settled();
            break;
          case 'navigate_arch':
            await asked('arch', a, 'navigate_arch works in pano mode');
            result = await settled();
            break;
          case 'views': {
            const data = await asked('views', a, 'saved views are available in MPR mode');
            result = a.op === 'list' ? data : await settled();
            break;
          }
          case 'reset_view':
            must(h.resetView(a.full === true));
            result = await settled();
            break;
          case 'snapshot': {
            // let the current frame settle before reading pixels
            await new Promise((r) => setTimeout(r, 150));
            const shot = await captureSnapshot();
            if (!shot.ok) throw new Error(shot.error ?? 'snapshot failed');
            result = { ...(shot.result as object), state: await fullState() };
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
    return () => {
      dead = true;
      es.close();
    };
  }, []);
}
