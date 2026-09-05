import Link from 'next/link';
import { PageShell } from '@/components/PageShell';

export const metadata = { title: '404 — GrowEazzy' };

// Next.js renders this for any route that falls through with no match —
// including a stale/mistyped `/[slug]` catalogue link, which is the most
// likely real-world hit. Wrapped in the same PageShell every real page
// uses, so a visitor landing here from a broken link still sees the site's
// actual header/nav/footer, not a bare, unbranded page.
export default function NotFound() {
  return (
    <PageShell>
      <section className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-3xl font-semibold text-gray-900">Page not found</h1>
        <p className="mt-3 text-gray-600">
          The page you&rsquo;re looking for doesn&rsquo;t exist, or may have moved.
        </p>
        <Link
          href="/"
          className="mt-8 inline-block rounded-md bg-brand px-6 py-2 font-medium text-white hover:opacity-90"
        >
          Back to home
        </Link>
      </section>
    </PageShell>
  );
}
