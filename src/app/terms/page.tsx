import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { LegalDraftNotice } from '@/components/LegalDraftNotice';

export const metadata = { title: 'Terms of Service — GrowEazzy' };

export default function TermsPage() {
  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-gray-900">Terms of Service</h1>
        <p className="mt-1 text-sm text-gray-400">Draft — not yet dated or versioned for release.</p>
        <div className="mt-6">
          <LegalDraftNotice />
        </div>

        <div className="space-y-6 text-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">1. Who these terms cover</h2>
            <p className="mt-1">
              These terms apply to anyone using GrowEazzy&apos;s website, purchasing a GrowEazzy
              service, or participating in the GrowEazzy Affiliate Programme.
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">2. Services</h2>
            <p className="mt-1">
              GrowEazzy sells Real Estate Qualified Buyers, AI Content Avatar, and Unlimited
              Video Editing directly. GrowEazzy is not a marketplace and does not act as an
              intermediary for third-party sellers.
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">3. Affiliate programme</h2>
            <p className="mt-1">
              The Affiliate Programme is single-level: affiliates earn commission only on sales
              they personally refer, and never on the activity of other affiliates. A
              registration fee may apply as shown at signup, and is admin-configurable and may
              be waived or discontinued at GrowEazzy&apos;s discretion. [Pending: cooling-off period
              length, grievance officer contact — see docs/ARCHITECTURE.md D-7, D-8.]
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">4. Payments and refunds</h2>
            <p className="mt-1">
              See the separate <Link href="/refund-policy" className="text-brand underline">Refund Policy</Link> for
              eligibility and timelines.
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">5. Limitation of liability</h2>
            <p className="mt-1">[Pending legal drafting.]</p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">6. Governing law</h2>
            <p className="mt-1">[Pending legal drafting — expected to be the laws of India.]</p>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
