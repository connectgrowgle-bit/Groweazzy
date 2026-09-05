import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { crmContacts } from '@/db/schema';
import { requirePermission } from '@/lib/auth/actor';
import { addNote } from '@/lib/crm/manage';

const schema = z.object({ body: z.string().min(1).max(5000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('crm.edit');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.id, id));
  if (!contact) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const note = await addNote(id, parsed.data.body, actor.user.id);
  return Response.json(note, { status: 201 });
}
