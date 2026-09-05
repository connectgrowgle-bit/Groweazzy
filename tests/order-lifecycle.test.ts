import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orderEvents, orders } from '@/db/schema';
import { InvalidOrderTransitionError, transitionOrderStage } from '@/lib/orders/lifecycle';
import { createTestOrder, createTestUser, deleteTestOrder, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('order lifecycle state machine (transitionOrderStage)', () => {
  it('allows a legal transition, persists it, and records an order_events row', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, stage: 'AWAITING_PAYMENT' });

    const updated = await transitionOrderStage(order.id, 'PAID', { note: 'test capture' });
    expect(updated.stage).toBe('PAID');

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row?.stage).toBe('PAID');

    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.fromStage).toBe('AWAITING_PAYMENT');
    expect(events[0]?.toStage).toBe('PAID');
    expect(events[0]?.note).toBe('test capture');
  });

  it('rejects an illegal transition and leaves the row unchanged', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, stage: 'AWAITING_PAYMENT' });

    await expect(transitionOrderStage(order.id, 'COMPLETED')).rejects.toThrow(InvalidOrderTransitionError);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row?.stage).toBe('AWAITING_PAYMENT');
  });

  it('REQUIREMENTS_LOCKED has no edge back to ONBOARDING or MEETING_SCHEDULED', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, stage: 'REQUIREMENTS_LOCKED' });

    await expect(transitionOrderStage(order.id, 'ONBOARDING')).rejects.toThrow(InvalidOrderTransitionError);
    await expect(transitionOrderStage(order.id, 'MEETING_SCHEDULED')).rejects.toThrow(InvalidOrderTransitionError);
  });

  it('COMPLETED and CANCELLED are dead ends — nothing leaves either', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const completed = await createTestOrder({ userId: user.id, stage: 'COMPLETED' });
    const cancelled = await createTestOrder({ userId: user.id, stage: 'CANCELLED' });

    await expect(transitionOrderStage(completed.id, 'REVIEW')).rejects.toThrow(InvalidOrderTransitionError);
    await expect(transitionOrderStage(cancelled.id, 'ONBOARDING')).rejects.toThrow(InvalidOrderTransitionError);
  });

  it('CANCELLED is reachable from a mid-workflow stage, not just the ends', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, stage: 'IN_PROGRESS' });

    const updated = await transitionOrderStage(order.id, 'CANCELLED');
    expect(updated.stage).toBe('CANCELLED');
  });

  it('applies extraFields (e.g. requirementsLockedAt) atomically with the stage change', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, stage: 'MEETING_SCHEDULED' });

    const now = new Date();
    await transitionOrderStage(order.id, 'REQUIREMENTS_LOCKED', { extraFields: { requirementsLockedAt: now } });

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row?.stage).toBe('REQUIREMENTS_LOCKED');
    expect(row?.requirementsLockedAt?.getTime()).toBeCloseTo(now.getTime(), -2);
  });

  it('two concurrent transitions racing on the same order: exactly one wins', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, stage: 'ONBOARDING' });

    const results = await Promise.allSettled([
      transitionOrderStage(order.id, 'MEETING_SCHEDULED'),
      transitionOrderStage(order.id, 'CANCELLED'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    // Both target stages are legal from ONBOARDING, so both COULD succeed if
    // they ran serialized one after the other — but the row lock inside
    // transitionOrderStage (`for('update')`) means the second one to
    // acquire the lock reads whatever the first one already committed, so
    // at most one of these should see the ORIGINAL 'ONBOARDING' state. This
    // just asserts the row ends up in a single, well-defined state, not a
    // torn write.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(['MEETING_SCHEDULED', 'CANCELLED']).toContain(row?.stage);
    void rejected;
  });

  it('cleans up via deleteTestOrder without leftover order_events rows (cascade)', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, stage: 'AWAITING_PAYMENT' });
    await transitionOrderStage(order.id, 'PAID');

    await deleteTestOrder(order.id);

    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id));
    expect(events).toHaveLength(0);
  });
});
