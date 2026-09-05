import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { TrainingAdminCourseEditor } from '@/components/TrainingAdminCourseEditor';
import { getActor } from '@/lib/auth/actor';

export const metadata = { title: 'Edit Course — GrowEazzy' };

export default async function TrainingAdminCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/login?next=/training/admin/${courseId}`);

  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <TrainingAdminCourseEditor courseId={courseId} />
      </section>
    </PageShell>
  );
}
