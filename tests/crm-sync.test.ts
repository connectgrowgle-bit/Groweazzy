import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { crmActivities, crmContacts } from '@/db/schema';
import { transitionOrderStage } from '@/lib/orders/lifecycle';
import { createTestOrder, createTestUser, deleteTestOrder, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('CRM self-population from order stage transitions (src/lib/crm/sync.ts)', () => {
  it('a stage with no CRM mapping (PAID) does not create a contact', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, stage: 'AWAITING_PAYMENT' });

    await transitionOrderStage(order.id, 'PAID');

    const rows = await db.select().from(crmContacts).where(eq(crmContacts.email, email));
    expect(rows).toHaveLength(0);
  });

  it('ONBOARDING creates the contact, at ONBOARDING, with an activity logged (fromStage null)', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, stage: 'PAID' });

    await transitionOrderStage(order.id, 'ONBOARDING');

    const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.email, email));
    expect(contact).toBeDefined();
    expect(contact?.stage).toBe('ONBOARDING');
    expect(contact?.userId).toBe(user.id);

    const activities = await db.select().from(crmActivities).where(eq(crmActivities.contactId, contact!.id));
    expect(activities).toHaveLength(1);
    expect(activities[0]?.fromStage).toBeNull();
    expect(activities[0]?.toStage).toBe('ONBOARDING');
    expect(activities[0]?.type).toBe('order_stage_change');
  });

  it('later transitions advance the same contact and log each move', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, stage: 'PAID' });

    await transitionOrderStage(order.id, 'ONBOARDING');
    await transitionOrderStage(order.id, 'MEETING_SCHEDULED');
    await transitionOrderStage(order.id, 'REQUIREMENTS_LOCKED', { extraFields: { requirementsLockedAt: new Date() } });
    await transitionOrderStage(order.id, 'TEAM_ASSIGNED');
    await transitionOrderStage(order.id, 'IN_PROGRESS');
    await transitionOrderStage(order.id, 'REVIEW');
    await transitionOrderStage(order.id, 'DELIVERED');
    await transitionOrderStage(order.id, 'COMPLETED');

    const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.email, email));
    expect(contact?.stage).toBe('COMPLETED');

    // MEETING_SCHEDULED and REQUIREMENTS_LOCKED both map to ONBOARDING —
    // same CRM stage as the previous one, so no activity/no-op for those,
    // only for stages that actually change the bucket.
    const activities = await db
      .select()
      .from(crmActivities)
      .where(eq(crmActivities.contactId, contact!.id))
      .orderBy(crmActivities.createdAt);
    const toStages = activities.map((a) => a.toStage);
    expect(toStages).toEqual(['ONBOARDING', 'IN_PROGRESS', 'REVIEW', 'DELIVERED', 'COMPLETED']);
  });

  it('a second order from the same buyer attaches to the same contact, not a duplicate', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const orderA = await createTestOrder({ userId: user.id, stage: 'PAID' });
    const orderB = await createTestOrder({ userId: user.id, stage: 'PAID' });

    await transitionOrderStage(orderA.id, 'ONBOARDING');
    await transitionOrderStage(orderB.id, 'ONBOARDING');

    const rows = await db.select().from(crmContacts).where(eq(crmContacts.email, email));
    expect(rows).toHaveLength(1);

    await deleteTestOrder(orderA.id);
    await deleteTestOrder(orderB.id);
  });

  it('backfills userId onto a pre-existing contact that had none (e.g. a lead-form row)', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, stage: 'PAID' });
    await db.insert(crmContacts).values({ email, stage: 'NEW' });

    await transitionOrderStage(order.id, 'ONBOARDING');

    const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.email, email));
    expect(contact?.userId).toBe(user.id);
    expect(contact?.stage).toBe('ONBOARDING');
  });

  it('CANCELLED moves the contact to CANCELLED too', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, stage: 'PAID' });
    await transitionOrderStage(order.id, 'ONBOARDING');

    await transitionOrderStage(order.id, 'CANCELLED');

    const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.email, email));
    expect(contact?.stage).toBe('CANCELLED');
  });
});
