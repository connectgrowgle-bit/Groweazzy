import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { OrderWorkspace } from '@/components/OrderWorkspace';
import { getActor } from '@/lib/auth/actor';

export const metadata = { title: 'Your Order — GrowEazzy' };

// Real authorization lives in GET /api/orders/[id] (ownership or
// order.view_all) — this page only needs a session to exist, same
// docs/ARCHITECTURE.md rule 11 split as /account and /affiliate/dashboard.
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/login?next=/orders/${id}`);

  return (
    <PageShell>
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">Your order</h1>
        <div className="mt-6">
          <OrderWorkspace orderId={id} />
        </div>
      </section>
    </PageShell>
  );
}
