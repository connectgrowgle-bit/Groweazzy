import { requirePermission } from '@/lib/auth/actor';
import { NoSuchRowError, unpublishCourse } from '@/lib/training/authoring';

// Unpublishing a course does NOT cascade to its modules/videos' own status
// columns — it doesn't need to. src/lib/training/catalogue.ts's read
// queries re-check the full ancestor chain on every request, so an
// unpublished course's modules/videos are unreachable to a learner
// immediately, regardless of what their own status column still says.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('training.course.publish');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  try {
    const updated = await unpublishCourse(id);
    return Response.json(updated);
  } catch (err) {
    if (err instanceof NoSuchRowError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
