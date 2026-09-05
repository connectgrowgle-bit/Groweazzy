import Link from 'next/link';
import { PageShell } from '@/components/PageShell';
import { getServices } from '@/lib/repository';
import { formatPaise } from '@/lib/format';

export const metadata = { title: 'Pricing — GrowEazzy' };

export default async function PricingPage() {
  const services = await getServices();

  return (
    <PageShell>
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="text-3xl font-semibold text-gray-900">Pricing</h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          One plan per service, priced simply. All amounts in INR, GST as applicable at checkout.
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {services.map((service) => (
            <div key={service.id} className="flex flex-col rounded-lg border border-gray-200 p-6">
              <div className="font-medium text-gray-900">{service.name}</div>
              <div className="mt-2 text-3xl font-semibold text-gray-900">
                {formatPaise(service.plans[0]?.pricePaise ?? 0)}
              </div>
              <div className="text-sm text-gray-500">{service.plans[0]?.billingNote}</div>
              <ul className="mt-4 flex-1 space-y-1 text-sm text-gray-600">
                {service.features.map((feature) => (
                  <li key={feature}>• {feature}</li>
                ))}
              </ul>
              <Link
                href={`/checkout?plan=${service.plans[0]?.id}`}
                className="mt-6 rounded-md bg-brand px-4 py-2 text-center font-medium text-white hover:opacity-90"
              >
                Get started
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-10 text-sm text-gray-500">
          Prices shown are read from our current catalogue and may change — the amount you&apos;re
          charged is always confirmed at checkout before payment, and existing orders are never
          repriced after purchase.
        </p>
      </section>
    </PageShell>
  );
}
