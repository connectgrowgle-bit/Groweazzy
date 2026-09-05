import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { onboardingSubmissions, orders, servicePlans, services } from '@/db/schema';
import { getOnboardingSchemas } from '@/lib/onboarding-schemas';

export class RequirementsLockedError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId}'s requirements are locked — submit a change request instead of editing the brief`);
    this.name = 'RequirementsLockedError';
  }
}

async function getOrderWithServiceSlug(
  orderId: string
): Promise<{ order: typeof orders.$inferSelect; serviceSlug: string }> {
  const [row] = await db
    .select({ order: orders, serviceSlug: services.slug })
    .from(orders)
    .innerJoin(servicePlans, eq(servicePlans.id, orders.servicePlanId))
    .innerJoin(services, eq(services.id, servicePlans.serviceId))
    .where(eq(orders.id, orderId));
  if (!row) throw new Error(`No such order: ${orderId}`);
  return row;
}

// There is no transition back from `requirements locked` to an editable
// state (docs/ARCHITECTURE.md §8) — enforced here, at the one place drafts
// and submissions are written, not by the order lifecycle state machine
// (which has nothing to say about onboarding data, only the order's stage).
function assertNotLocked(order: typeof orders.$inferSelect): void {
  if (order.requirementsLockedAt) throw new RequirementsLockedError(order.id);
}

// Draft schema is deliberately permissive (everything optional) — this is
// "save and come back," never a completeness check. Upserts on the table's
// own one-row-per-order unique index.
export async function saveOnboardingDraft(
  orderId: string,
  data: unknown
): Promise<typeof onboardingSubmissions.$inferSelect> {
  const { order, serviceSlug } = await getOrderWithServiceSlug(orderId);
  assertNotLocked(order);

  const { draft } = getOnboardingSchemas(serviceSlug);
  const parsed = draft.parse(data) as Record<string, unknown>;

  const [row] = await db
    .insert(onboardingSubmissions)
    .values({ orderId, data: parsed, isDraft: 'true' })
    .onConflictDoUpdate({
      target: onboardingSubmissions.orderId,
      set: { data: parsed, isDraft: 'true', updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error('Upsert did not return a row');
  return row;
}

// Submitting the brief does NOT lock requirements (docs/ARCHITECTURE.md §8)
// — the kickoff call still happens between this and the explicit, separate
// lock action in src/lib/orders/lock.ts. A client can submit, then submit
// again (e.g. after the call surfaces a correction) right up until locking.
export async function submitOnboarding(
  orderId: string,
  data: unknown
): Promise<typeof onboardingSubmissions.$inferSelect> {
  const { order, serviceSlug } = await getOrderWithServiceSlug(orderId);
  assertNotLocked(order);

  const { submit } = getOnboardingSchemas(serviceSlug);
  const parsed = submit.parse(data) as Record<string, unknown>;

  const [row] = await db
    .insert(onboardingSubmissions)
    .values({ orderId, data: parsed, isDraft: 'false', submittedAt: new Date() })
    .onConflictDoUpdate({
      target: onboardingSubmissions.orderId,
      set: { data: parsed, isDraft: 'false', submittedAt: new Date(), updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error('Upsert did not return a row');
  return row;
}
