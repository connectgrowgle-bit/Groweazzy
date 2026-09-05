import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { getServices } from '@/lib/repository';

export default async function HomePage() {
  const services = await getServices();

  return (
    <PageShell>
      <section className="mx-auto max-w-6xl px-6 py-20 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
          Performance marketing, <span className="text-brand">done for you</span>.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
          GrowEazzy runs three done-for-you services for builders, founders and agencies —
          plus a referral programme for partners who want to earn alongside us.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <Link href="/services" className="rounded-md bg-brand px-6 py-3 font-medium text-white hover:opacity-90">
            Explore services
          </Link>
          <Link
            href="/affiliate"
            className="rounded-md border border-gray-300 px-6 py-3 font-medium text-gray-700 hover:bg-gray-50"
          >
            Become an affiliate
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-gray-500">
          What we do
        </h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {services.map((service) => (
            <Link
              key={service.id}
              href={`/${service.slug}`}
              className="rounded-lg border border-gray-200 p-6 transition hover:border-brand hover:shadow-sm"
            >
              <div className="font-medium text-gray-900">{service.name}</div>
              <p className="mt-2 text-sm text-gray-500">{service.shortDescription}</p>
              <p className="mt-2 text-xs uppercase tracking-wide text-gray-400">{service.audience}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-gray-100 bg-gray-50 py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-2xl font-semibold text-gray-900">Know someone who needs this?</h2>
          <p className="mt-2 text-gray-600">
            Refer them to GrowEazzy and earn a commission on every sale — single-level, no
            recruiting required.
          </p>
          <Link
            href="/affiliate"
            className="mt-6 inline-block rounded-md bg-brand px-6 py-3 font-medium text-white hover:opacity-90"
          >
            See the affiliate programme
          </Link>
        </div>
      </section>
    </PageShell>
  );
}
