import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { crmActivities, crmContacts, orders, profiles, users } from '@/db/schema';

type CrmStage = typeof crmContacts.$inferSelect.stage;
// The transaction object src/lib/orders/lifecycle.ts's db.transaction(...)
// callback passes in — derived from db.transaction's own callback
// parameter type rather than typeof db, since drizzle's transaction object
// isn't quite the same type (it lacks db's own $client field) even though
// it exposes the same select/insert/update surface this function uses.
type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Order stage -> CRM pipeline stage (docs/ARCHITECTURE.md §9). Not every
// order stage gets its own bucket: MEETING_SCHEDULED and
// REQUIREMENTS_LOCKED are still "getting the client onboarded" from a
// pipeline point of view, not a distinct stage a sales/ops screen needs to
// tell apart. AWAITING_PAYMENT has no entry at all — nobody is a contact
// worth tracking before they've paid for something (a future lead-capture
// flow would create a NEW/CONTACTED/QUALIFIED contact some other way; order
// stage sync never touches those pre-purchase stages).
const ORDER_STAGE_TO_CRM_STAGE: Partial<Record<string, CrmStage>> = {
  ONBOARDING: 'ONBOARDING',
  MEETING_SCHEDULED: 'ONBOARDING',
  REQUIREMENTS_LOCKED: 'ONBOARDING',
  TEAM_ASSIGNED: 'IN_PROGRESS',
  IN_PROGRESS: 'IN_PROGRESS',
  REVIEW: 'REVIEW',
  DELIVERED: 'DELIVERED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

// "The CRM fills itself from the workflow — it is not a separate system
// someone has to remember to update" (docs/ARCHITECTURE.md §9). Called from
// INSIDE src/lib/orders/lifecycle.ts's transitionOrderStage, on every legal
// order stage change, so this runs no matter which endpoint (present or
// future) triggered the transition — a webhook, the checkout confirm
// route, staff scheduling a meeting, or a future order-fulfillment action —
// rather than being a call every one of those call sites has to remember
// to make itself.
//
// Creates the contact on its first relevant transition (normally
// PAID -> ONBOARDING) if it doesn't exist yet, or advances an existing one
// — deduped on email, and backfilling `userId` onto a contact that predates
// the account (e.g. a lead-form row), same reasoning as Phase 6's original
// upsertContactForOrder this function replaces. A transition with no CRM
// mapping (AWAITING_PAYMENT, or the stage already matches) is a no-op.
//
// Known, documented simplification: a contact's stage is "whichever order
// touched it most recently," not an aggregate across all of a buyer's
// orders. For a single-seller business where a contact normally has one
// active order at a time this is the right behaviour; a buyer with two
// orders active at once could see the earlier order's stage change stop
// being reflected the moment the newer order's own transition overwrites
// it. Flagged here rather than solved with per-order CRM rows, which would
// need its own UI/permissions work this phase doesn't scope for.
export async function syncContactFromOrderStage(tx: DbOrTx, orderId: string, toStage: string): Promise<void> {
  const crmStage = ORDER_STAGE_TO_CRM_STAGE[toStage];
  if (!crmStage) return;

  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error(`No such order: ${orderId}`);
  const [user] = await tx.select().from(users).where(eq(users.id, order.userId));
  if (!user) throw new Error(`No such user: ${order.userId}`);

  let [contact] = await tx.select().from(crmContacts).where(eq(crmContacts.email, user.email));
  const fromStage: CrmStage | null = contact?.stage ?? null;

  if (!contact) {
    const [profile] = await tx.select().from(profiles).where(eq(profiles.userId, user.id));
    const [created] = await tx
      .insert(crmContacts)
      .values({ userId: user.id, email: user.email, fullName: profile?.fullName ?? null, stage: crmStage })
      .returning();
    if (!created) throw new Error('Insert did not return a row');
    contact = created;
  } else {
    if (fromStage === crmStage && contact.userId) return; // nothing changed — no activity to log

    const [updated] = await tx
      .update(crmContacts)
      .set({ stage: crmStage, userId: contact.userId ?? user.id, updatedAt: new Date() })
      .where(eq(crmContacts.id, contact.id))
      .returning();
    if (!updated) throw new Error('Update did not return a row');
    contact = updated;
  }

  await tx.insert(crmActivities).values({
    contactId: contact.id,
    type: 'order_stage_change',
    fromStage: fromStage ?? undefined,
    toStage: crmStage,
    note: `Order ${orderId} -> ${toStage}`,
  });
}
