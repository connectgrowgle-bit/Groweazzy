import { z } from 'zod';
import { requirePermission } from '@/lib/auth/actor';
import { getCourseWithEverything, NoSuchRowError, updateCourse } from '@/lib/training/authoring';

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  orderIndex: z.number().int().optional(),
});

// The authoring view of one course: every module and video regardless of
// status, unlike the learner-facing GET /api/training/courses/[id].
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('training.course.author');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const detail = await getCourseWithEverything(id);
  if (!detail) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(detail);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('training.course.author');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const updated = await updateCourse(id, parsed.data);
    return Response.json(updated);
  } catch (err) {
    if (err instanceof NoSuchRowError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
