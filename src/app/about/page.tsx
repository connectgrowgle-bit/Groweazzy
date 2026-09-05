import { PageShell } from '@/components/PageShell';

export const metadata = { title: 'About — GrowEazzy' };

export default function AboutPage() {
  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-gray-900">About GrowEazzy</h1>
        <div className="mt-6 space-y-4 text-gray-700">
          <p>
            GrowEazzy is a single-seller performance marketing platform based in India. We run
            three services ourselves — Real Estate Qualified Buyers, AI Content Avatar, and
            Unlimited Video Editing — rather than operating as a marketplace connecting you to
            outside vendors.
          </p>
          <p>
            Alongside our services, we run a single-level affiliate programme: partners who
            refer clients to GrowEazzy earn a commission on the resulting sale, with nothing
            earned from recruiting other affiliates.
          </p>
          <p>
            We serve clients and partners across India, with support available in English and
            Hinglish.
          </p>
        </div>
      </section>
    </PageShell>
  );
}
