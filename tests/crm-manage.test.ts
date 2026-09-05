import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { crmActivities, crmContacts, crmNotes, crmTasks } from '@/db/schema';
import { addNote, assignContact, createTask, editContact, NoSuchUserError, updateTask } from '@/lib/crm/manage';
import { createTestUser, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

async function createLeadContact(email: string) {
  const [contact] = await db.insert(crmContacts).values({ email, stage: 'NEW' }).returning();
  if (!contact) throw new Error('failed to create test contact');
  return contact;
}

describe('editContact (src/lib/crm/manage.ts)', () => {
  it('updates fields and logs a manual_stage_change activity only when the stage actually changes', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const contact = await createLeadContact(email);
    // Link it so deleteTestUser's crmContacts.userId cleanup catches it.
    await db.update(crmContacts).set({ userId: user.id }).where(eq(crmContacts.id, contact.id));

    const updated = await editContact(contact.id, { fullName: 'Test Name', stage: 'CONTACTED' }, user.id);
    expect(updated.fullName).toBe('Test Name');
    expect(updated.stage).toBe('CONTACTED');

    const activities = await db.select().from(crmActivities).where(eq(crmActivities.contactId, contact.id));
    expect(activities).toHaveLength(1);
    expect(activities[0]?.type).toBe('manual_stage_change');
    expect(activities[0]?.fromStage).toBe('NEW');
    expect(activities[0]?.toStage).toBe('CONTACTED');

    // A field-only edit (no stage change) logs nothing new.
    await editContact(contact.id, { phone: '9999999999' });
    const activitiesAfter = await db.select().from(crmActivities).where(eq(crmActivities.contactId, contact.id));
    expect(activitiesAfter).toHaveLength(1);
  });
});

describe('assignContact (src/lib/crm/manage.ts)', () => {
  it('sets the owner and logs an activity', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const { user: staff } = await createTestUser();
    createdUserIds.push(staff.id);
    const contact = await createLeadContact(email);
    await db.update(crmContacts).set({ userId: user.id }).where(eq(crmContacts.id, contact.id));

    const updated = await assignContact(contact.id, staff.id, staff.id);
    expect(updated.ownerUserId).toBe(staff.id);

    const activities = await db.select().from(crmActivities).where(eq(crmActivities.contactId, contact.id));
    expect(activities.some((a) => a.type === 'assigned')).toBe(true);
  });

  it('rejects assigning to a user that does not exist', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const contact = await createLeadContact(email);
    await db.update(crmContacts).set({ userId: user.id }).where(eq(crmContacts.id, contact.id));

    await expect(assignContact(contact.id, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NoSuchUserError
    );
  });
});

describe('addNote / createTask / updateTask (src/lib/crm/manage.ts)', () => {
  it('adds a note and logs an activity', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const contact = await createLeadContact(email);
    await db.update(crmContacts).set({ userId: user.id }).where(eq(crmContacts.id, contact.id));

    const note = await addNote(contact.id, 'Called, left voicemail', user.id);
    expect(note.body).toBe('Called, left voicemail');

    const notes = await db.select().from(crmNotes).where(eq(crmNotes.contactId, contact.id));
    expect(notes).toHaveLength(1);

    const activities = await db.select().from(crmActivities).where(eq(crmActivities.contactId, contact.id));
    expect(activities.some((a) => a.type === 'note_added')).toBe(true);
  });

  it('creates a task and updates its status', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const contact = await createLeadContact(email);
    await db.update(crmContacts).set({ userId: user.id }).where(eq(crmContacts.id, contact.id));

    const task = await createTask({ contactId: contact.id, title: 'Follow up tomorrow' });
    expect(task.status).toBe('OPEN');

    const updated = await updateTask(task.id, { status: 'DONE' });
    expect(updated.status).toBe('DONE');

    const rows = await db.select().from(crmTasks).where(eq(crmTasks.id, task.id));
    expect(rows[0]?.status).toBe('DONE');
  });
});
