'use client';

import { PageShell } from '@/components/PageShell';

// Route-segment error boundary — catches a throw anywhere under the root
// layout without losing the layout itself (unlike global-error.tsx, this
// keeps the real header/nav/footer visible). Must be a Client Component:
// Next.js only wires error boundaries to components in the client bundle.
//
// `error.message` is intentionally never rendered — in production Next.js
// already strips the real message from what's sent to the browser (only
// `error.digest`, a lookup key into the server-side log, survives), but
// there is no reason to render arbitrary error text to an anonymous
// visitor even in development, so this stays a fixed, generic message on
// purpose rather than something that would need re-checking every time
// Next.js changes what it forwards.
export default function GlobalPageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <PageShell>
      <section className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-3xl font-semibold text-gray-900">Something went wrong</h1>
        <p className="mt-3 text-gray-600">
          Sorry — an unexpected error occurred. Please try again, or contact us if it keeps happening.
        </p>
        {error.digest && <p className="mt-2 text-xs text-gray-400">Reference: {error.digest}</p>}
        <button
          type="button"
          onClick={() => reset()}
          className="mt-8 inline-block rounded-md bg-brand px-6 py-2 font-medium text-white hover:opacity-90"
        >
          Try again
        </button>
      </section>
    </PageShell>
  );
}
