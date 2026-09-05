import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { TrainingAdminCourseList } from '@/components/TrainingAdminCourseList';
import { getActor } from '@/lib/auth/actor';

export const metadata = { title: 'Training Admin — GrowEazzy' };

export default async function TrainingAdminPage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/training/admin');

  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">Training — Author</h1>
        <div className="mt-6">
          <TrainingAdminCourseList />
        </div>
      </section>
    </PageShell>
  );
}
