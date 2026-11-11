// The user manual inside the viewer (docs/web-build.md, section 13). The pages are the ones
// scripts/manual-html.mjs renders into manual/ on this same origin; the drawer shows one in
// an iframe, with the manual's own table of contents and search, in the dark theme of the
// viewer whatever the system setting. It is a column of the
// viewer's row, so opening it narrows the viewer and covers no control (AGENTS.md, hard
// rule 4). The website opens the same pages in a new tab instead (CbctApp's help menu).

import { IS_DESKTOP } from './shell';

/** the manual page a mode's reading guide is, or the 2D radiographs section of chapter 4 */
export function guidePage(viewMode: string, isXray: boolean): string {
  return isXray ? '04-opening-scans.html#45-2d-radiographs' : `${viewMode}.html`;
}

/** the address of a manual page, relative to the viewer's page, so a base path holds */
export const manualHref = (page: string) => `manual/${page}`;

/** the drawer's address: the same page with ?theme=dark, so it matches the viewer beside it */
export function drawerSrc(page: string): string {
  const [file, hash] = page.split('#');
  return `${manualHref(file)}?theme=dark${hash ? `#${hash}` : ''}`;
}

/**
 * The desktop app's Help menu (desktop/main.mjs, desktop/native.mjs) asks for the manual with
 * this window event. The page answers through its own help menu, so the drawer opens exactly
 * as a click there opens it; nothing crosses the window's context isolation but the event.
 * Outside the app the event does nothing.
 */
export const MANUAL_EVENT = 'cbctscope:manual';

async function openManualFromShell(): Promise<void> {
  if (!IS_DESKTOP) return;
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('header button')];
  const entry = () =>
    buttons().find((b) => b.classList.contains('menu-item') && /user manual$/i.test(b.textContent?.trim() ?? ''));
  let target = entry();
  if (!target) {
    buttons()
      .find((b) => /^help\b/i.test(b.textContent?.trim() ?? ''))
      ?.click();
    for (let i = 0; i < 40 && !(target = entry()); i++) await new Promise((r) => setTimeout(r, 25));
  }
  target?.click();
}

if (typeof window !== 'undefined') window.addEventListener(MANUAL_EVENT, () => void openManualFromShell());

export default function ManualDrawer({ page, onClose }: { page: string; onClose: () => void }) {
  return (
    <aside
      aria-label="User manual"
      data-testid="manual-drawer"
      style={{
        flex: '0 0 auto',
        width: 'min(460px, 40vw)',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--border)',
        background: 'var(--panel)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <strong style={{ fontSize: 12 }}>User manual</strong>
        <button
          onClick={onClose}
          title="close the manual; the viewer takes the width back"
          style={{
            marginLeft: 'auto',
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--panel-2)',
            color: 'var(--text)',
            fontSize: 12,
          }}
        >
          Close manual ✕
        </button>
      </div>
      <iframe
        title="CBCTScope user manual"
        src={drawerSrc(page)}
        style={{ flex: 1, minHeight: 0, width: '100%', border: 0, background: 'var(--bg)' }}
      />
    </aside>
  );
}
