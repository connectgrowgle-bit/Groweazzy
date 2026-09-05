import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { AdminServiceList } from '@/components/AdminServiceList';
import { getActor } from '@/lib/auth/actor';

export const metadata = { title: 'Services — Admin — GrowEazzy' };

export default async function AdminServicesPage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/admin/services');

  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">Services & pricing</h1>
        <div className="mt-6">
          <AdminServiceList />
        </div>
      </section>
    </PageShell>
  );
}
