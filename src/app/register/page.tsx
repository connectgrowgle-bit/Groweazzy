import Link from 'next/link';
import { PageShell } from '@/components/PageShell';

export const metadata = { title: 'Register — GrowEazzy' };

// Phase 1 scope: page shell and form only — see the note in login/page.tsx.
// `plan` / `as` query params (from service pages and /affiliate) are read
// here for informational display; the actual checkout/affiliate-signup flow
// is wired in Phase 3 (affiliate) and Phase 6 (client checkout).
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; as?: string }>;
}) {
  const { plan, as } = await searchParams;
  const isAffiliateSignup = as === 'affiliate';

  return (
    <PageShell>
      <section className="mx-auto max-w-sm px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">
          {isAffiliateSignup ? 'Register as an affiliate' : 'Create an account'}
        </h1>
        {plan && <p className="mt-1 text-sm text-gray-500">Selected plan: {plan}</p>}

        <form className="mt-8 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Full name</label>
            <input className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" disabled />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input type="email" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" disabled />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <input type="password" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" disabled />
          </div>
          <button
            type="button"
            disabled
            title="Account creation launches with Phase 2"
            className="w-full cursor-not-allowed rounded-md bg-brand px-6 py-2 font-medium text-white opacity-50"
          >
            Create account
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link href="/login" className="text-brand hover:underline">
            Log in
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-gray-400">Account creation launches with Phase 2.</p>
      </section>
    </PageShell>
  );
}
