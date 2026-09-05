import Link from 'next/link';
import { PageShell } from '@/components/PageShell';

export const metadata = { title: 'Log in — GrowEazzy' };

// Phase 1 scope: page shell and form only. Wiring to /api/auth/login,
// session creation, and MFA challenge is Phase 2 — see
// docs/ARCHITECTURE.md §4. The form is intentionally inert until then
// rather than faking a submit that goes nowhere.
export default function LoginPage() {
  return (
    <PageShell>
      <section className="mx-auto max-w-sm px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">Log in</h1>

        <form className="mt-8 space-y-4">
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
            title="Account login launches with Phase 2"
            className="w-full cursor-not-allowed rounded-md bg-brand px-6 py-2 font-medium text-white opacity-50"
          >
            Log in
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-brand hover:underline">
            Register
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-gray-400">Account login launches with Phase 2.</p>
      </section>
    </PageShell>
  );
}
