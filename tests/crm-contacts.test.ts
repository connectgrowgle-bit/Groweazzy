import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { crmActivities, crmContacts } from '@/db/schema';
import { upsertContactForOrder } from '@/lib/crm/contacts';
import { createTestOrder, createTestUser, deleteTestOrder, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('upsertContactForOrder (src/lib/crm/contacts.ts)', () => {
  it('creates a new contact linked to the buyer, at ONBOARDING stage, with an activity logged', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id });

    const contact = await upsertContactForOrder(order.id);
    expect(contact.email).toBe(email);
    expect(contact.userId).toBe(user.id);
    expect(contact.stage).toBe('ONBOARDING');

    const activities = await db.select().from(crmActivities).where(eq(crmActivities.contactId, contact.id));
    expect(activities).toHaveLength(1);
    expect(activities[0]?.type).toBe('order_created');
  });

  it('a second order from the same buyer attaches to the SAME contact — no duplicate by email', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const orderA = await createTestOrder({ userId: user.id });
    const orderB = await createTestOrder({ userId: user.id });

    const contactA = await upsertContactForOrder(orderA.id);
    const contactB = await upsertContactForOrder(orderB.id);

    expect(contactB.id).toBe(contactA.id);

    const rows = await db.select().from(crmContacts).where(eq(crmContacts.email, contactA.email));
    expect(rows).toHaveLength(1);

    // Two orders -> two logged activities against the one contact.
    const activities = await db.select().from(crmActivities).where(eq(crmActivities.contactId, contactA.id));
    expect(activities).toHaveLength(2);

    await deleteTestOrder(orderA.id);
    await deleteTestOrder(orderB.id);
  });

  it('backfills userId onto a pre-existing contact that had none (e.g. from a lead form)', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id });

    // Simulate a lead-capture contact that predates this account.
    await db.insert(crmContacts).values({ email, stage: 'NEW' });

    const contact = await upsertContactForOrder(order.id);
    expect(contact.userId).toBe(user.id);

    const rows = await db.select().from(crmContacts).where(eq(crmContacts.email, email));
    expect(rows).toHaveLength(1);
  });
});
