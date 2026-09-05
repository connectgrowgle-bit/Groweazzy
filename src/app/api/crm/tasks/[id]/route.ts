import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { crmTasks } from '@/db/schema';
import { requirePermission } from '@/lib/auth/actor';
import { updateTask } from '@/lib/crm/manage';

const schema = z.object({
  title: z.string().min(1).max(300).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
  status: z.enum(['OPEN', 'DONE', 'CANCELLED']).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('crm.task.manage');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const [task] = await db.select().from(crmTasks).where(eq(crmTasks.id, id));
  if (!task) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await updateTask(id, {
    ...parsed.data,
    dueAt: parsed.data.dueAt === undefined ? undefined : parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
  });
  return Response.json(updated);
}
