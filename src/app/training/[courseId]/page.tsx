import { redirect } from 'next/navigation';
import { PageShell } from '@/components/PageShell';
import { TrainingCourseDetail } from '@/components/TrainingCourseDetail';
import { getActor } from '@/lib/auth/actor';

export const metadata = { title: 'Course — GrowEazzy' };

export default async function TrainingCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const actor = await getActor();
  if (!actor) redirect(`/login?next=/training/${courseId}`);

  return (
    <PageShell>
      <section className="mx-auto max-w-3xl px-6 py-16">
        <TrainingCourseDetail courseId={courseId} />
      </section>
    </PageShell>
  );
}
