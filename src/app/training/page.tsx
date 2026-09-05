import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { TrainingCourseList } from '@/components/TrainingCourseList';
import { getActor } from '@/lib/auth/actor';

export const metadata = { title: 'Training — GrowEazzy' };

// Real authorization lives in GET /api/training/courses (canAccessTraining
// — ACTIVE affiliates, or staff who can author) — this page only needs a
// session to exist, same split as every other page (docs/ARCHITECTURE.md
// rule 11). A logged-in customer who isn't an affiliate just sees the 403
// message TrainingCourseList renders for a failed fetch.
export default async function TrainingPage() {
  const actor = await getActor();
  if (!actor) redirect('/login?next=/training');

  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-gray-900">Training</h1>
        <div className="mt-6">
          <TrainingCourseList />
        </div>
      </section>
    </PageShell>
  );
}
