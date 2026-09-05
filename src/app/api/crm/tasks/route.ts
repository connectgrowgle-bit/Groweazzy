import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { crmContacts } from '@/db/schema';
import { requirePermission } from '@/lib/auth/actor';
import { createTask } from '@/lib/crm/manage';

const schema = z.object({
  contactId: z.string().uuid(),
  title: z.string().min(1).max(300),
  dueAt: z.string().datetime().optional(),
  assignedUserId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const actor = await requirePermission('crm.task.manage');
  if (actor instanceof Response) return actor;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.id, parsed.data.contactId));
  if (!contact) return Response.json({ error: 'No such CRM contact' }, { status: 404 });

  const task = await createTask({
    contactId: parsed.data.contactId,
    title: parsed.data.title,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
    assignedUserId: parsed.data.assignedUserId,
  });

  return Response.json(task, { status: 201 });
}
