import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { getServices } from '@/lib/repository';
import { formatPaise } from '@/lib/format';

export const metadata = { title: 'Services — GrowEazzy' };

export default async function ServicesPage() {
  const services = await getServices();

  return (
    <PageShell>
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-gray-900">Our services</h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          Three done-for-you services. No marketplace, no third-party vendors — you work with
          GrowEazzy&apos;s own team from kickoff to delivery.
        </p>

        <div className="mt-10 grid gap-8">
          {services.map((service) => (
            <div key={service.id} className="rounded-lg border border-gray-200 p-8">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-semibold text-gray-900">{service.name}</h2>
                <span className="text-sm text-gray-500">
                  from {formatPaise(service.plans[0]?.pricePaise ?? 0)} {service.plans[0]?.billingNote}
                </span>
              </div>
              <p className="mt-1 text-brand">{service.tagline}</p>
              <ul className="mt-4 space-y-1 text-sm text-gray-600">
                {service.features.map((feature) => (
                  <li key={feature}>• {feature}</li>
                ))}
              </ul>
              <Link
                href={`/${service.slug}`}
                className="mt-5 inline-block text-sm font-medium text-brand hover:underline"
              >
                Learn more →
              </Link>
            </div>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
