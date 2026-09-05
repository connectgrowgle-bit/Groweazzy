import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { CrmPipeline } from '@/components/CrmPipeline';
import { getActor } from '@/lib/auth/actor';

export const metadata = { title: 'CRM — GrowEazzy' };

// Real authorization lives in GET /api/crm/contacts (crm.view) — this page
// only needs a session to exist, same split as every other staff/account
// page (docs/ARCHITECTURE.md rule 11). A logged-in customer without
// crm.view just sees the 403 CrmPipeline renders for a failed fetch.
export default async function CrmPage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/crm');

  return (
    <PageShell>
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">CRM Pipeline</h1>
        <div className="mt-6">
          <CrmPipeline />
        </div>
      </section>
    </PageShell>
  );
}
