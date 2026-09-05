import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { servicePlanPriceHistory, services, servicePlans } from '@/db/schema';

export class NoSuchRowError extends Error {
  constructor(table: string, id: string) {
    super(`No such ${table}: ${id}`);
    this.name = 'NoSuchRowError';
  }
}

// --- service.edit: copy only (name, tagline, audience, description,
// features, howItWorks, isActive) — never price, never a plan. Someone
// trusted to fix a typo is not thereby trusted to reprice the catalogue or
// add/retire a plan (docs/ARCHITECTURE.md §11).

export async function listServicesForAdmin(): Promise<(typeof services.$inferSelect)[]> {
  return db.select().from(services).orderBy(asc(services.createdAt));
}

export async function getServiceForAdmin(
  serviceId: string
): Promise<{ service: typeof services.$inferSelect; plans: (typeof servicePlans.$inferSelect)[] } | null> {
  const [service] = await db.select().from(services).where(eq(services.id, serviceId));
  if (!service) return null;
  const plans = await db.select().from(servicePlans).where(eq(servicePlans.serviceId, serviceId)).orderBy(asc(servicePlans.createdAt));
  return { service, plans };
}

export async function createService(params: {
  slug: string;
  name: string;
  tagline?: string;
  audience?: string;
  shortDescription: string;
  longDescriptionHtml: string;
  features?: string[];
  howItWorks?: string[];
}): Promise<typeof services.$inferSelect> {
  const [service] = await db
    .insert(services)
    .values({
      slug: params.slug,
      name: params.name,
      tagline: params.tagline ?? '',
      audience: params.audience ?? '',
      shortDescription: params.shortDescription,
      longDescriptionHtml: params.longDescriptionHtml,
      features: params.features ?? [],
      howItWorks: params.howItWorks ?? [],
    })
    .returning();
  if (!service) throw new Error('Insert did not return a row');
  return service;
}

export async function updateServiceCopy(
  serviceId: string,
  updates: {
    name?: string;
    tagline?: string;
    audience?: string;
    shortDescription?: string;
    longDescriptionHtml?: string;
    features?: string[];
    howItWorks?: string[];
    isActive?: 'true' | 'false';
  }
): Promise<typeof services.$inferSelect> {
  const [updated] = await db
    .update(services)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(services.id, serviceId))
    .returning();
  if (!updated) throw new NoSuchRowError('service', serviceId);
  return updated;
}

// --- service.pricing: "amounts, plans" (docs/ARCHITECTURE.md §11) —
// creating a plan, deactivating one, renaming it, or changing its price.
// Only the price path requires a reason and writes history; creating a
// brand-new plan has no "old price" to record a change against.

export async function createServicePlan(params: {
  serviceId: string;
  key: string;
  name: string;
  pricePaise: number;
  billingNote?: string;
}): Promise<typeof servicePlans.$inferSelect> {
  const [plan] = await db
    .insert(servicePlans)
    .values({
      serviceId: params.serviceId,
      key: params.key,
      name: params.name,
      pricePaise: params.pricePaise,
      billingNote: params.billingNote ?? '',
    })
    .returning();
  if (!plan) throw new Error('Insert did not return a row');
  return plan;
}

export async function updateServicePlanDetails(
  planId: string,
  updates: { name?: string; billingNote?: string; isActive?: 'true' | 'false' }
): Promise<typeof servicePlans.$inferSelect> {
  const [updated] = await db
    .update(servicePlans)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(servicePlans.id, planId))
    .returning();
  if (!updated) throw new NoSuchRowError('service plan', planId);
  return updated;
}

// "Every price change requires a reason and writes a
// service_plan_price_history row in the same transaction as the price
// update — so 'what did this cost on the day this specific order was
// placed' is always answerable, and existing orders are never
// retroactively repriced" (docs/ARCHITECTURE.md §11). Orders already don't
// look this table up for their own amount (they store amountPaise at
// purchase time, src/lib/orders/checkout.ts) — this history exists purely
// as the catalogue's own audit trail of "who changed this, when, and why."
export async function updateServicePlanPrice(
  planId: string,
  newPricePaise: number,
  reason: string,
  changedByUserId: string
): Promise<typeof servicePlans.$inferSelect> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(servicePlans).where(eq(servicePlans.id, planId)).for('update');
    if (!current) throw new NoSuchRowError('service plan', planId);

    await tx.insert(servicePlanPriceHistory).values({
      servicePlanId: planId,
      oldPricePaise: current.pricePaise,
      newPricePaise,
      reason,
      changedByUserId,
    });

    const [updated] = await tx
      .update(servicePlans)
      .set({ pricePaise: newPricePaise, updatedAt: new Date() })
      .where(eq(servicePlans.id, planId))
      .returning();
    if (!updated) throw new Error('Update did not return a row');
    return updated;
  });
}

export async function getServicePlanPriceHistory(
  planId: string
): Promise<(typeof servicePlanPriceHistory.$inferSelect)[]> {
  return db
    .select()
    .from(servicePlanPriceHistory)
    .where(eq(servicePlanPriceHistory.servicePlanId, planId))
    .orderBy(asc(servicePlanPriceHistory.createdAt));
}
