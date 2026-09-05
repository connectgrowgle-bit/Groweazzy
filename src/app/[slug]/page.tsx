import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { getServiceBySlug, getServices } from '@/lib/repository';
import { formatPaise } from '@/lib/format';

// Top-level slug on purpose: referral links are `/[service-slug]?ref=CODE`
// (docs/ARCHITECTURE.md §6) and must work from any public URL, not just a
// path nested under /services/. The `?ref=` param itself is not handled
// until Phase 4 (attribution) — this route only needs to exist at the right
// path shape for that to slot in later without a URL change.
export async function generateStaticParams() {
  const services = await getServices();
  return services.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = await getServiceBySlug(slug);
  if (!service) return {};
  return { title: `${service.name} — GrowEazzy` };
}

export default async function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const service = await getServiceBySlug(slug);
  if (!service) notFound();

  return (
    <PageShell>
      <section className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-sm uppercase tracking-wide text-gray-400">{service.audience}</p>
        <h1 className="mt-2 text-3xl font-semibold text-gray-900">{service.name}</h1>
        <p className="mt-2 text-lg text-brand">{service.tagline}</p>

        <div className="mt-10 grid gap-10 sm:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              What you get
            </h2>
            <ul className="mt-3 space-y-2 text-gray-700">
              {service.features.map((feature) => (
                <li key={feature}>• {feature}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              How it works
            </h2>
            <ol className="mt-3 space-y-2 text-gray-700">
              {service.howItWorks.map((step, i) => (
                <li key={step}>
                  {i + 1}. {step}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="mt-12 rounded-lg border border-gray-200 bg-gray-50 p-8">
          {service.plans.map((plan) => (
            <div key={plan.id} className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="font-medium text-gray-900">{plan.name}</div>
                <div className="text-2xl font-semibold text-gray-900">
                  {formatPaise(plan.pricePaise)}{' '}
                  <span className="text-sm font-normal text-gray-500">{plan.billingNote}</span>
                </div>
              </div>
              <Link
                href={`/checkout?plan=${plan.id}`}
                className="rounded-md bg-brand px-6 py-3 font-medium text-white hover:opacity-90"
              >
                Get started
              </Link>
            </div>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
