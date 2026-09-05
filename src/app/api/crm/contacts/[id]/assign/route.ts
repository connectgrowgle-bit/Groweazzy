import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { crmContacts } from '@/db/schema';
import { requirePermission } from '@/lib/auth/actor';
import { assignContact, NoSuchUserError } from '@/lib/crm/manage';
import { logAudit } from '@/lib/auth/audit';

const schema = z.object({ ownerUserId: z.string().uuid() });

// A distinct permission from crm.edit on purpose (docs/ARCHITECTURE.md §4's
// permission catalogue, not a role-string branch) — who owns a contact is
// a different decision from what's true about them.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('crm.assign');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.id, id));
  if (!contact) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const updated = await assignContact(id, parsed.data.ownerUserId, actor.user.id);
    await logAudit({
      actorUserId: actor.user.id,
      action: 'crm.contact.assign',
      outcome: 'ALLOWED',
      targetType: 'crm_contact',
      targetId: id,
      metadata: { ownerUserId: parsed.data.ownerUserId },
    });
    return Response.json(updated);
  } catch (err) {
    if (err instanceof NoSuchUserError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
