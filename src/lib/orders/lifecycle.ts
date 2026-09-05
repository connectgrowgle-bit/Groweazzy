import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orderEvents, orders } from '@/db/schema';
import { syncContactFromOrderStage } from '@/lib/crm/sync';

// Service → checkout → payment → verification → order → CRM contact →
// onboarding → meeting → requirements locked → team assigned → work →
// review → delivery → completion (docs/ARCHITECTURE.md §8).
//
// REQUIREMENTS_LOCKED has no edge back to ONBOARDING/MEETING_SCHEDULED —
// "there is no transition back from locked" is enforced here, not left to
// callers to remember. REVIEW -> IN_PROGRESS and DELIVERED -> REVIEW exist
// because delivery review and revision requests are a normal part of the
// work, not an error state; PAID/ONBOARDING both keep an edge back to each
// other's neighbor implicitly through this same guarded transition
// function, never a raw column write.
//
// CANCELLED is reachable from every non-terminal stage — a client or an
// admin can call off an order at any point before completion — but nothing
// leaves CANCELLED or COMPLETED once there.
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  AWAITING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['ONBOARDING', 'CANCELLED'],
  ONBOARDING: ['MEETING_SCHEDULED', 'CANCELLED'],
  MEETING_SCHEDULED: ['REQUIREMENTS_LOCKED', 'ONBOARDING', 'CANCELLED'],
  REQUIREMENTS_LOCKED: ['TEAM_ASSIGNED', 'CANCELLED'],
  TEAM_ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['REVIEW', 'CANCELLED'],
  REVIEW: ['DELIVERED', 'IN_PROGRESS', 'CANCELLED'],
  DELIVERED: ['COMPLETED', 'REVIEW', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export class InvalidOrderTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot transition order stage from ${from} to ${to}`);
    this.name = 'InvalidOrderTransitionError';
  }
}

// Same shape as src/lib/affiliate/lifecycle.ts's transitionAffiliateStatus:
// locks the row (`for('update')`) before checking legality, inside one
// transaction, so two concurrent transitions on the same order (e.g. a
// webhook marking PAID while a client-facing cancel request races it)
// serialize instead of both succeeding into contradictory states.
export async function transitionOrderStage(
  orderId: string,
  to: string,
  options: { extraFields?: Record<string, unknown>; actorUserId?: string; note?: string } = {}
): Promise<typeof orders.$inferSelect> {
  const { extraFields = {}, actorUserId, note } = options;
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!current) throw new Error(`No such order: ${orderId}`);

    const allowed = ALLOWED_TRANSITIONS[current.stage] ?? [];
    if (!allowed.includes(to)) {
      throw new InvalidOrderTransitionError(current.stage, to);
    }

    const [updated] = await tx
      .update(orders)
      .set({ stage: to as typeof orders.$inferSelect.stage, updatedAt: new Date(), ...extraFields })
      .where(eq(orders.id, orderId))
      .returning();
    if (!updated) throw new Error('Update did not return a row');

    // Append-only timeline — order_events is the record of what happened;
    // crm_contacts/crm_activities (below) is the derived, self-populating
    // view built on top of it (docs/ARCHITECTURE.md §9).
    await tx.insert(orderEvents).values({
      orderId,
      fromStage: current.stage as typeof orders.$inferSelect.stage,
      toStage: to as typeof orders.$inferSelect.stage,
      actorUserId,
      note,
    });

    // Runs on every legal transition, from every call site (present or
    // future), rather than each one having to remember its own CRM call —
    // "fills itself from the workflow," not a second system someone has to
    // keep in sync by hand.
    await syncContactFromOrderStage(tx, orderId, to);

    return updated;
  });
}
