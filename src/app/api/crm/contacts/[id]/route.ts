import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { crmActivities, crmContacts, crmNotes, crmTasks, orders, servicePlans, services } from '@/db/schema';
import { requirePermission } from '@/lib/auth/actor';
import { editContact } from '@/lib/crm/manage';
import { logAudit } from '@/lib/auth/audit';

const CRM_STAGES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'ONBOARDING',
  'IN_PROGRESS',
  'REVIEW',
  'DELIVERED',
  'COMPLETED',
  'LOST',
  'CANCELLED',
] as const;

const patchSchema = z.object({
  fullName: z.string().max(200).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  stage: z.enum(CRM_STAGES).optional(),
});

// One contact's whole record: the contact itself, its activity timeline
// (which order-stage transitions and manual edits both write to — see
// src/lib/crm/sync.ts and src/lib/crm/manage.ts), notes, open/closed tasks,
// and every order linked by userId (only meaningful once a contact is
// linked to an account — a lead-form-only contact has none yet).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('crm.view');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.id, id));
  if (!contact) return Response.json({ error: 'Not found' }, { status: 404 });

  const [activities, notes, tasks, linkedOrders] = await Promise.all([
    db.select().from(crmActivities).where(eq(crmActivities.contactId, id)).orderBy(desc(crmActivities.createdAt)),
    db.select().from(crmNotes).where(eq(crmNotes.contactId, id)).orderBy(desc(crmNotes.createdAt)),
    db.select().from(crmTasks).where(eq(crmTasks.contactId, id)).orderBy(desc(crmTasks.dueAt)),
    contact.userId
      ? db
          .select({ order: orders, plan: servicePlans, service: services })
          .from(orders)
          .innerJoin(servicePlans, eq(servicePlans.id, orders.servicePlanId))
          .innerJoin(services, eq(services.id, servicePlans.serviceId))
          .where(eq(orders.userId, contact.userId))
          .orderBy(desc(orders.createdAt))
      : Promise.resolve([]),
  ]);

  return Response.json({
    contact,
    activities,
    notes,
    tasks,
    orders: linkedOrders.map((row) => ({
      id: row.order.id,
      stage: row.order.stage,
      amountPaise: row.order.amountPaise,
      service: { slug: row.service.slug, name: row.service.name },
      plan: { name: row.plan.name },
    })),
  });
}

// Manual corrections — a name/phone fix, or moving a pre-purchase contact
// through NEW -> CONTACTED -> QUALIFIED -> LOST, none of which the
// order-driven sync ever touches (src/lib/crm/sync.ts only writes
// ONBOARDING onward).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('crm.edit');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const [existing] = await db.select().from(crmContacts).where(eq(crmContacts.id, id));
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await editContact(id, parsed.data, actor.user.id);

  await logAudit({
    actorUserId: actor.user.id,
    action: 'crm.contact.edit',
    outcome: 'ALLOWED',
    targetType: 'crm_contact',
    targetId: id,
  });

  return Response.json(updated);
}
