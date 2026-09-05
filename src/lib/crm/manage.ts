import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { crmActivities, crmContacts, crmNotes, crmTasks, users } from '@/db/schema';

export class NoSuchUserError extends Error {
  constructor(userId: string) {
    super(`No such user: ${userId}`);
    this.name = 'NoSuchUserError';
  }
}

// Manual, staff-driven edits — distinct from the automatic
// syncContactFromOrderStage (src/lib/crm/sync.ts) that drives a contact's
// stage from the order workflow itself. A manual edit here is for the
// stages sync never touches (NEW/CONTACTED/QUALIFIED/LOST, or correcting a
// name/phone) — it does not stop a later order transition from moving the
// stage again afterward, same as any other field on this row.
export async function editContact(
  contactId: string,
  updates: { fullName?: string | null; phone?: string | null; stage?: typeof crmContacts.$inferSelect.stage },
  actorUserId?: string
): Promise<typeof crmContacts.$inferSelect> {
  const [before] = await db.select().from(crmContacts).where(eq(crmContacts.id, contactId));
  if (!before) throw new Error(`No such CRM contact: ${contactId}`);

  const [updated] = await db
    .update(crmContacts)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(crmContacts.id, contactId))
    .returning();
  if (!updated) throw new Error('Update did not return a row');

  if (updates.stage && updates.stage !== before.stage) {
    await db.insert(crmActivities).values({
      contactId,
      type: 'manual_stage_change',
      fromStage: before.stage,
      toStage: updates.stage,
      actorUserId,
      note: 'Changed by staff',
    });
  }

  return updated;
}

export async function assignContact(
  contactId: string,
  ownerUserId: string,
  actorUserId?: string
): Promise<typeof crmContacts.$inferSelect> {
  const [owner] = await db.select().from(users).where(eq(users.id, ownerUserId));
  if (!owner) throw new NoSuchUserError(ownerUserId);

  const [updated] = await db
    .update(crmContacts)
    .set({ ownerUserId, updatedAt: new Date() })
    .where(eq(crmContacts.id, contactId))
    .returning();
  if (!updated) throw new Error(`No such CRM contact: ${contactId}`);

  await db.insert(crmActivities).values({
    contactId,
    type: 'assigned',
    actorUserId,
    note: `Assigned to ${owner.email}`,
  });

  return updated;
}

export async function addNote(
  contactId: string,
  body: string,
  authorUserId: string
): Promise<typeof crmNotes.$inferSelect> {
  const [note] = await db.insert(crmNotes).values({ contactId, authorUserId, body }).returning();
  if (!note) throw new Error('Insert did not return a row');

  await db.insert(crmActivities).values({
    contactId,
    type: 'note_added',
    actorUserId: authorUserId,
  });

  return note;
}

export async function createTask(params: {
  contactId: string;
  title: string;
  dueAt?: Date;
  assignedUserId?: string;
}): Promise<typeof crmTasks.$inferSelect> {
  const [task] = await db
    .insert(crmTasks)
    .values({
      contactId: params.contactId,
      title: params.title,
      dueAt: params.dueAt,
      assignedUserId: params.assignedUserId,
    })
    .returning();
  if (!task) throw new Error('Insert did not return a row');
  return task;
}

export async function updateTask(
  taskId: string,
  updates: {
    title?: string;
    dueAt?: Date | null;
    assignedUserId?: string | null;
    status?: typeof crmTasks.$inferSelect.status;
  }
): Promise<typeof crmTasks.$inferSelect> {
  const [updated] = await db.update(crmTasks).set(updates).where(eq(crmTasks.id, taskId)).returning();
  if (!updated) throw new Error(`No such CRM task: ${taskId}`);
  return updated;
}
