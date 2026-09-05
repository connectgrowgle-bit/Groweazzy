import { PageShell } from '@/components/PageShell';
import { LegalDraftNotice } from '@/components/LegalDraftNotice';

export const metadata = { title: 'Refund Policy — GrowEazzy' };

export default function RefundPolicyPage() {
  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-gray-900">Refund Policy</h1>
        <p className="mt-1 text-sm text-gray-400">Draft — not yet dated or versioned for release.</p>
        <div className="mt-6">
          <LegalDraftNotice />
        </div>

        <div className="space-y-6 text-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">1. Service orders</h2>
            <p className="mt-1">[Pending: refund eligibility window and conditions per service.]</p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">2. How refunds are processed</h2>
            <p className="mt-1">
              Approved refunds are issued to the original payment method via Razorpay. A
              refund that reverses a sale attributed to an affiliate reverses a proportional
              share of that affiliate&apos;s commission — see our Affiliate Terms.
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">3. Affiliate registration fee</h2>
            <p className="mt-1">[Pending: refund eligibility for the affiliate registration fee, including any cooling-off period — see docs/ARCHITECTURE.md D-7.]</p>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
