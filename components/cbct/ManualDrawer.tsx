// The user manual inside the viewer (docs/web-build.md, section 13). The pages are the ones
// scripts/manual-html.mjs renders into manual/ on this same origin; the drawer shows one in
// an iframe, with the manual's own table of contents and search, in the dark theme of the
// viewer whatever the system setting. It is a column of the
// viewer's row, so opening it narrows the viewer and covers no control (AGENTS.md, hard
// rule 4). The website opens the same pages in a new tab instead (CbctApp's help menu).


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
 * this window event. CbctApp listens for it and opens this drawer at the manual's index page
 * through the same state its help menu sets; nothing crosses the window's context isolation
 * but the event. Outside the app the event does nothing.
 */
export const MANUAL_EVENT = 'cbctscope:manual';

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
          padding: '8px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <strong style={{ fontSize: 'var(--fs-meta)', fontWeight: 600 }}>User manual</strong>
        <button
          className="ctl"
          onClick={onClose}
          title="close the manual; the viewer takes the width back"
          style={{ marginLeft: 'auto' }}
        >
          Close manual
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
