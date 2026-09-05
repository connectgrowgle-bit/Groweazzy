import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { AffiliateDashboard } from '@/components/AffiliateDashboard';
import { getActor } from '@/lib/auth/actor';

export const metadata = { title: 'Affiliate Dashboard — GrowEazzy' };

export default async function AffiliateDashboardPage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/affiliate/dashboard');

  return (
    <PageShell>
      <section className="mx-auto max-w-xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">Affiliate Dashboard</h1>
        <div className="mt-6">
          <AffiliateDashboard />
        </div>
      </section>
    </PageShell>
  );
}
