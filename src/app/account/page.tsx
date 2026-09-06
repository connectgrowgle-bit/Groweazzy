import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { LogoutButton } from '@/components/LogoutButton';
import { MfaSettings } from '@/components/MfaSettings';
import { getActor } from '@/lib/auth/actor';
import { getPermissionsForUser } from '@/lib/auth/rbac';
import { canAccessTraining } from '@/lib/training/access';

export const metadata = { title: 'Account — GrowEazzy' };

// The real authorization boundary for this page — middleware.ts only
// short-circuits unauthenticated requests as a UX nicety; this server-side
// check is what actually protects the page (docs/ARCHITECTURE.md rule 11).
// Delete middleware.ts and this line still keeps the page inaccessible
// without a valid session.
export default async function AccountPage() {
  const actor = await getActor();
  if (!actor) redirect('/login');

  const permissions = await getPermissionsForUser(actor.user.id);
  const canSeeTraining = await canAccessTraining(actor.user.id);

  return (
    <PageShell>
      <section className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">Your account</h1>
        <dl className="mt-6 space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="w-32 text-gray-500">Email</dt>
            <dd className="text-gray-900">{actor.user.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-32 text-gray-500">MFA</dt>
            <dd className="text-gray-900">{actor.user.mfaEnabled ? 'Enabled' : 'Not enabled'}</dd>
          </div>
          {permissions.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-32 text-gray-500">Permissions</dt>
              <dd className="text-gray-900">{permissions.join(', ')}</dd>
            </div>
          )}
        </dl>

        <MfaSettings initiallyEnabled={actor.user.mfaEnabled} />

        <div className="mt-8 flex items-center gap-4">
          <Link href="/affiliate/dashboard" className="text-sm text-brand hover:underline">
            Affiliate dashboard →
          </Link>
          {permissions.includes('crm.view') && (
            <Link href="/crm" className="text-sm text-brand hover:underline">
              CRM →
            </Link>
          )}
          {canSeeTraining && (
            <Link href="/training" className="text-sm text-brand hover:underline">
              Training →
            </Link>
          )}
          {permissions.includes('training.course.author') && (
            <Link href="/training/admin" className="text-sm text-brand hover:underline">
              Training — Author →
            </Link>
          )}
          {(permissions.includes('service.view') ||
            permissions.includes('report.revenue.view') ||
            permissions.includes('report.affiliate.view')) && (
            <Link href="/admin" className="text-sm text-brand hover:underline">
              Admin →
            </Link>
          )}
        </div>
        <div className="mt-4">
          <LogoutButton />
        </div>
      </section>
    </PageShell>
  );
}
