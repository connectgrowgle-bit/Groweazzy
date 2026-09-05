import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { CheckoutFlow } from '@/components/CheckoutFlow';
import { getActor } from '@/lib/auth/actor';
import { getServicePlan } from '@/lib/repository';
import { formatPaise } from '@/lib/format';

export const metadata = { title: 'Checkout — GrowEazzy' };

// "Service → checkout" (docs/ARCHITECTURE.md §8). `plan` is a static
// catalogue plan id (src/lib/repository.ts) — the same one every service
// page's "Get started" button already links with. An anonymous visitor is
// sent to register first, with `plan` carried through so they land right
// back here once their account exists (see src/app/register/page.tsx).
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan: planId } = await searchParams;
  if (!planId) redirect('/services');

  const found = await getServicePlan(planId);
  if (!found) redirect('/services');

  const actor = await getActor();
  if (!actor) redirect(`/register?plan=${planId}`);

  return (
    <PageShell>
      <section className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">Checkout</h1>

        <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-6">
          <div className="text-sm text-gray-500">{found.service.name}</div>
          <div className="mt-1 font-medium text-gray-900">{found.plan.name}</div>
          <div className="mt-2 text-2xl font-semibold text-gray-900">
            {formatPaise(found.plan.pricePaise)}{' '}
            <span className="text-sm font-normal text-gray-500">{found.plan.billingNote}</span>
          </div>
        </div>

        <div className="mt-8">
          <CheckoutFlow planId={planId} />
        </div>
      </section>
    </PageShell>
  );
}
