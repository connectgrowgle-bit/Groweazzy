import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { LegalDraftNotice } from '@/components/LegalDraftNotice';

export const metadata = { title: 'Privacy Policy — GrowEazzy' };

export default function PrivacyPage() {
  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-gray-900">Privacy Policy</h1>
        <p className="mt-1 text-sm text-gray-400">Draft — not yet dated or versioned for release.</p>
        <div className="mt-6">
          <LegalDraftNotice />
        </div>

        <div className="space-y-6 text-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">1. What we collect</h2>
            <p className="mt-1">
              Account details (name, email, phone), order and onboarding information, and — for
              affiliates — KYC documents (PAN, bank details) required to process payouts and
              meet regulatory obligations.
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">2. How KYC data is handled</h2>
            <p className="mt-1">
              PAN and bank account details are encrypted at rest. Only the last four characters
              of each are ever shown in your dashboard. [Pending: retention period for KYC data
              after account closure — see docs/ARCHITECTURE.md §14.]
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">3. How we use your data</h2>
            <p className="mt-1">[Pending legal drafting.]</p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">4. Your rights</h2>
            <p className="mt-1">[Pending legal drafting — to align with applicable Indian data protection law.]</p>
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">5. Contact</h2>
            <p className="mt-1">
              Questions about this policy can be sent via our <Link href="/contact" className="text-brand underline">contact form</Link>.
              [Pending: named grievance/privacy officer contact.]
            </p>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
