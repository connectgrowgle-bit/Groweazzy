import { requireActor } from '@/lib/auth/actor';
import { canAccessTraining } from '@/lib/training/access';
import { getPublishedCourseDetail } from '@/lib/training/catalogue';
import { getProgressForUser } from '@/lib/training/progress';

// Course detail with its published modules/videos, plus this learner's own
// progress on each video so the page can render a checkmark/percentage
// without N extra requests.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  if (!(await canAccessTraining(actor.user.id))) {
    return Response.json({ error: 'Training is available to active affiliates' }, { status: 403 });
  }

  const { id } = await params;
  const detail = await getPublishedCourseDetail(id);
  if (!detail) return Response.json({ error: 'Not found' }, { status: 404 });

  const videoIds = detail.modules.flatMap((m) => m.videos.map((v) => v.id));
  const progress = await getProgressForUser(actor.user.id, videoIds);

  return Response.json({
    course: detail.course,
    modules: detail.modules.map(({ module, videos }) => ({
      module,
      videos: videos.map((video) => {
        const p = progress.get(video.id);
        return { video, progress: p ? { secondsWatched: p.secondsWatched, completedAt: p.completedAt } : null };
      }),
    })),
  });
}
