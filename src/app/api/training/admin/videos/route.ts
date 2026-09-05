import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { trainingModules } from '@/db/schema';
import { requirePermission } from '@/lib/auth/actor';
import { createVideo } from '@/lib/training/authoring';

const schema = z.object({
  moduleId: z.string().uuid(),
  title: z.string().min(1).max(200),
  videoUrl: z.string().url(),
  durationSeconds: z.number().int().positive(),
});

export async function POST(request: Request) {
  const actor = await requirePermission('training.course.author');
  if (actor instanceof Response) return actor;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [module] = await db.select().from(trainingModules).where(eq(trainingModules.id, parsed.data.moduleId));
  if (!module) return Response.json({ error: 'No such module' }, { status: 404 });

  const video = await createVideo(parsed.data);
  return Response.json(video, { status: 201 });
}
