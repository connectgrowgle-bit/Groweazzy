import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { AdminDashboard } from '@/components/AdminDashboard';
import { getActor } from '@/lib/auth/actor';
import { getPermissionsForUser } from '@/lib/auth/rbac';

export const metadata = { title: 'Admin — GrowEazzy' };

export default async function AdminPage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/admin');

  const permissions = await getPermissionsForUser(actor.user.id);

  return (
    <PageShell>
      <section className="mx-auto max-w-4xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">Admin</h1>
        <div className="mt-6">
          <AdminDashboard />
        </div>

        <div className="mt-10 flex flex-wrap gap-4 border-t border-gray-200 pt-6">
          {permissions.includes('service.view') && (
            <Link href="/admin/services" className="text-sm text-brand hover:underline">
              Services & pricing →
            </Link>
          )}
          {permissions.includes('crm.view') && (
            <Link href="/crm" className="text-sm text-brand hover:underline">
              CRM →
            </Link>
          )}
          {permissions.includes('training.course.author') && (
            <Link href="/training/admin" className="text-sm text-brand hover:underline">
              Training — Author →
            </Link>
          )}
        </div>
      </section>
    </PageShell>
  );
}
