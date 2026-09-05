import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { RegisterForm } from '@/components/RegisterForm';

export const metadata = { title: 'Register — GrowEazzy' };

// `plan` / `as` query params (from service pages and /affiliate) are read
// here for informational display only. Registration always creates a plain
// customer account (src/app/api/auth/register/route.ts) — actually starting
// checkout for a plan is wired in Phase 6, and the affiliate signup flow
// (KYC, fee payment) in Phase 3; neither exists yet, so those params don't
// change what this form submits, only what it tells the visitor.
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
        <h1 className="text-2xl font-semibold text-gray-900">Create an account</h1>
        {isAffiliateSignup && (
          <p className="mt-1 text-sm text-gray-500">
            Affiliate registration (KYC, fee payment) isn&apos;t live yet — this creates your
            GrowEazzy account so you&apos;re ready when it is.
          </p>
        )}
        {plan && !isAffiliateSignup && (
          <p className="mt-1 text-sm text-gray-500">
            Selected plan: {plan}. Checkout isn&apos;t live yet — this creates your account first.
          </p>
        )}
        <RegisterForm />
        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link href="/login" className="text-brand hover:underline">
            Log in
          </Link>
        </p>
      </section>
    </PageShell>
  );
}
