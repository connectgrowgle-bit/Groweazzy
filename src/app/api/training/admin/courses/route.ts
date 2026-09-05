import { z } from 'zod';
import { requirePermission } from '@/lib/auth/actor';
import { createCourse, getAllCourses } from '@/lib/training/authoring';

const createSchema = z.object({ title: z.string().min(1).max(200), description: z.string().max(5000).optional() });

// Every course regardless of status — the authoring UI's own list, not
// what a learner sees (GET /api/training/courses is that, published-only).
export async function GET() {
  const actor = await requirePermission('training.course.author');
  if (actor instanceof Response) return actor;

  const courses = await getAllCourses();
  return Response.json({ courses });
}

export async function POST(request: Request) {
  const actor = await requirePermission('training.course.author');
  if (actor instanceof Response) return actor;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const course = await createCourse(parsed.data);
  return Response.json(course, { status: 201 });
}
