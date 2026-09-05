import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { formatPaise } from '@/lib/format';

export const metadata = { title: 'Affiliate Programme — GrowEazzy' };

// Figures here match the defaults in commissionPolicies (src/db/schema/affiliate.ts)
// and are admin-configurable — this page should eventually read them via the
// repository seam once Phase 9 moves commissionPolicies into the admin
// dashboard. For Phase 1 they're the same static defaults as the schema.
const COMMISSION_RATE_PERCENT = 10;
const REGISTRATION_FEE_PAISE = 200000; // ₹2,000
const MIN_PAYOUT_PAISE = 100000; // ₹1,000

export default function AffiliatePage() {
  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-gray-900">Affiliate Programme</h1>
        <p className="mt-2 text-lg text-gray-600">
          Refer clients to GrowEazzy&apos;s services and earn a commission on every sale.
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 p-6 text-center">
            <div className="text-3xl font-semibold text-brand">{COMMISSION_RATE_PERCENT}%</div>
            <div className="mt-1 text-sm text-gray-500">commission per sale</div>
          </div>
          <div className="rounded-lg border border-gray-200 p-6 text-center">
            <div className="text-3xl font-semibold text-brand">Fortnightly</div>
            <div className="mt-1 text-sm text-gray-500">
              payouts, {formatPaise(MIN_PAYOUT_PAISE)} minimum, TDS deducted
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 p-6 text-center">
            <div className="text-3xl font-semibold text-brand">Single-level</div>
            <div className="mt-1 text-sm text-gray-500">no earnings from recruiting others</div>
          </div>
        </div>

        <div className="mt-12 space-y-4 text-gray-700">
          <h2 className="text-xl font-semibold text-gray-900">How it works</h2>
          <ol className="space-y-2">
            <li>1. Register as an affiliate and complete KYC verification.</li>
            <li>
              2. Pay the one-time registration fee of {formatPaise(REGISTRATION_FEE_PAISE)}, which
              includes affiliate onboarding training.
            </li>
            <li>3. Get your unique referral links for each GrowEazzy service.</li>
            <li>4. Earn {COMMISSION_RATE_PERCENT}% commission on every sale you refer.</li>
            <li>5. Get paid fortnightly once your available balance clears the minimum.</li>
          </ol>
        </div>

        <div className="mt-8 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The affiliate programme, including the registration fee, is governed by our{' '}
          <Link href="/terms" className="underline">
            Affiliate Terms
          </Link>
          . The fee may be reduced or waived by GrowEazzy at any time.
        </div>

        <Link
          href="/register?as=affiliate"
          className="mt-8 inline-block rounded-md bg-brand px-6 py-3 font-medium text-white hover:opacity-90"
        >
          Register as an affiliate
        </Link>
      </section>
    </PageShell>
  );
}
