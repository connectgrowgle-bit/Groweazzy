import { requirePermission } from '@/lib/auth/actor';
import { NoSuchRowError, publishCourse } from '@/lib/training/authoring';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('training.course.publish');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  try {
    const updated = await publishCourse(id);
    return Response.json(updated);
  } catch (err) {
    if (err instanceof NoSuchRowError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
