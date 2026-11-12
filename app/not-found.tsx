// The page for an address the site does not have: the viewer's dark ground and type, one title,
// and a link back to the viewer (next/link adds the base path in a sub-path build).
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found: CBCTScope' };

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          maxWidth: 460,
          width: '100%',
          background: 'var(--panel)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '18px 20px',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <h1 style={{ fontSize: 16, margin: '0 0 10px' }}>Page not found</h1>
        <p style={{ margin: '0 0 14px' }}>CBCTScope has no page at this address.</p>
        <Link href="/" className="ctl">
          Back to the viewer
        </Link>
      </div>
    </main>
  );
}
