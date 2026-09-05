import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { AdminServiceEditor } from '@/components/AdminServiceEditor';
import { getActor } from '@/lib/auth/actor';

export const metadata = { title: 'Edit Service — GrowEazzy' };

export default async function AdminServiceEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/login?next=/admin/services/${id}`);

  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <AdminServiceEditor serviceId={id} />
      </section>
    </PageShell>
  );
}
