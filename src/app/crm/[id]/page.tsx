import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { CrmContactDetail } from '@/components/CrmContactDetail';
import { getActor } from '@/lib/auth/actor';

export const metadata = { title: 'CRM Contact — GrowEazzy' };

export default async function CrmContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/login?next=/crm/${id}`);

  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <CrmContactDetail contactId={id} />
      </section>
    </PageShell>
  );
}
