import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { RegisterForm } from '@/components/RegisterForm';

export const metadata = { title: 'Register — GrowEazzy' };

// `plan` / `as` query params (from service pages and /affiliate) are read
// here for informational display only. Registration always creates a plain
// customer account (src/app/api/auth/register/route.ts) — starting checkout
// for a plan is still Phase 6, but affiliate signup (KYC, fee payment) is
// live as of Phase 3: `as=affiliate` sends the visitor straight to the
// affiliate dashboard to continue there after their account is created.
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; as?: string }>;
}) {
  const { plan, as } = await searchParams;
  const isAffiliateSignup = as === 'affiliate';
  const next = isAffiliateSignup ? '/affiliate/dashboard' : undefined;

  return (
    <PageShell>
      <section className="mx-auto max-w-sm px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">Create an account</h1>
        {isAffiliateSignup && (
          <p className="mt-1 text-sm text-gray-500">
            Create your account, then continue to KYC and the registration fee on your affiliate
            dashboard.
          </p>
        )}
        {plan && !isAffiliateSignup && (
          <p className="mt-1 text-sm text-gray-500">
            Selected plan: {plan}. Checkout isn&apos;t live yet — this creates your account first.
          </p>
        )}
        <RegisterForm next={next} />
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
