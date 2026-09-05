import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { services, servicePlans } from '@/db/schema';
import { getServicePlan as getStaticServicePlan, getServices } from '@/lib/repository';

// Core logic behind scripts/seed/catalogue.ts — exported separately so
// tests can seed the real service_plans rows an order's FK needs directly
// against the test database, same reasoning as src/lib/auth/seed-rbac.ts
// being split out from scripts/seed/roles-permissions.ts. Idempotent on
// (slug) for services and (service_id, name) for plans
// (service_plans_service_name_uidx) — safe to call more than once.
export async function seedCatalogueFromRepository(): Promise<void> {
  const staticServices = await getServices();

  for (const service of staticServices) {
    const [row] = await db
      .insert(services)
      .values({
        slug: service.slug,
        name: service.name,
        shortDescription: service.shortDescription,
        longDescriptionHtml: service.tagline,
      })
      .onConflictDoUpdate({
        target: services.slug,
        set: { name: service.name, shortDescription: service.shortDescription, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error(`Upsert did not return a row for service ${service.slug}`);

    for (const plan of service.plans) {
      await db
        .insert(servicePlans)
        .values({ serviceId: row.id, name: plan.name, pricePaise: plan.pricePaise })
        .onConflictDoUpdate({
          target: [servicePlans.serviceId, servicePlans.name],
          set: { pricePaise: plan.pricePaise, updatedAt: new Date() },
        });
    }
  }
}

export class CataloguePlanNotSeededError extends Error {
  constructor(staticPlanId: string) {
    super(`Service plan "${staticPlanId}" has no matching database row — run npm run db:seed:catalogue`);
    this.name = 'CataloguePlanNotSeededError';
  }
}

// Bridges the Phase 1 static content seam (src/lib/repository.ts) to the
// real DB row Phase 6's orders.servicePlanId FK needs to point at, ahead of
// Phase 9 formally moving the catalogue into the database. Looks the
// static plan up by its (service slug, plan name) pair — the same pair
// scripts/seed/catalogue.ts upserts on — never by array position or a
// freshly-generated id, since neither is a stable identifier across reseeds.
export async function resolveServicePlan(
  staticPlanId: string
): Promise<{ service: typeof services.$inferSelect; plan: typeof servicePlans.$inferSelect }> {
  const found = await getStaticServicePlan(staticPlanId);
  if (!found) throw new CataloguePlanNotSeededError(staticPlanId);

  const [service] = await db.select().from(services).where(eq(services.slug, found.service.slug));
  if (!service) throw new CataloguePlanNotSeededError(staticPlanId);

  const [plan] = await db
    .select()
    .from(servicePlans)
    .where(and(eq(servicePlans.serviceId, service.id), eq(servicePlans.name, found.plan.name)));
  if (!plan) throw new CataloguePlanNotSeededError(staticPlanId);

  return { service, plan };
}
