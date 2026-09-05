'use client';

// Only fires when the ROOT LAYOUT itself throws — src/app/error.tsx
// handles every other in-tree error and keeps the real header/footer
// intact. This one has to render its own <html>/<body> because at this
// point Next.js has thrown away the layout that would have provided them,
// so it deliberately does not import PageShell/globals.css or rely on any
// component tree that could itself be the reason layout.tsx failed —
// plain inline styles only, so this has as little as possible left to
// break.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: '4rem 1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ marginTop: '0.75rem', color: '#4b5563' }}>
          Sorry — GrowEazzy hit an unexpected error. Please try again shortly.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: '2rem',
            borderRadius: '0.375rem',
            padding: '0.5rem 1.5rem',
            background: '#111827',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
