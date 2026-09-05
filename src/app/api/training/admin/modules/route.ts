import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { trainingCourses } from '@/db/schema';
import { requirePermission } from '@/lib/auth/actor';
import { createModule } from '@/lib/training/authoring';

const schema = z.object({ courseId: z.string().uuid(), title: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const actor = await requirePermission('training.course.author');
  if (actor instanceof Response) return actor;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [course] = await db.select().from(trainingCourses).where(eq(trainingCourses.id, parsed.data.courseId));
  if (!course) return Response.json({ error: 'No such course' }, { status: 404 });

  const created = await createModule(parsed.data);
  return Response.json(created, { status: 201 });
}
