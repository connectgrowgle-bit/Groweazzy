import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { services, servicePlans } from '@/db/schema';
import { SEED_SERVICES } from './catalogue-seed-data';

// Core logic behind scripts/seed/catalogue.ts — exported separately so
// tests can seed the real service_plans rows an order's FK needs directly
// against the test database, same reasoning as src/lib/auth/seed-rbac.ts
// being split out from scripts/seed/roles-permissions.ts. Idempotent on
// (slug) for services and (service_id, name) for plans
// (service_plans_service_name_uidx) — safe to call more than once.
//
// Seeds from SEED_SERVICES (src/lib/catalogue-seed-data.ts), NOT from
// src/lib/repository.ts's getServices() — as of Phase 9 that function
// reads from the very rows this seeds, so calling it here would be
// circular. The seed data is the one-time bootstrap; the database is the
// live source from here on (edited via /admin/services).
export async function seedCatalogueFromRepository(): Promise<void> {
  for (const service of SEED_SERVICES) {
    const [row] = await db
      .insert(services)
      .values({
        slug: service.slug,
        name: service.name,
        tagline: service.tagline,
        audience: service.audience,
        shortDescription: service.shortDescription,
        longDescriptionHtml: service.tagline,
        features: service.features,
        howItWorks: service.howItWorks,
      })
      .onConflictDoUpdate({
        target: services.slug,
        set: {
          name: service.name,
          tagline: service.tagline,
          audience: service.audience,
          shortDescription: service.shortDescription,
          features: service.features,
          howItWorks: service.howItWorks,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error(`Upsert did not return a row for service ${service.slug}`);

    for (const plan of service.plans) {
      await db
        .insert(servicePlans)
        .values({
          serviceId: row.id,
          key: plan.key,
          name: plan.name,
          pricePaise: plan.pricePaise,
          billingNote: plan.billingNote,
        })
        .onConflictDoUpdate({
          target: [servicePlans.serviceId, servicePlans.name],
          set: { key: plan.key, pricePaise: plan.pricePaise, billingNote: plan.billingNote, updatedAt: new Date() },
        });
    }
  }
}

export class CataloguePlanNotSeededError extends Error {
  constructor(planKey: string) {
    super(`Service plan "${planKey}" does not exist, is not active, or has no matching database row — run npm run db:seed:catalogue`);
    this.name = 'CataloguePlanNotSeededError';
  }
}

// The one place checkout resolves a plan key (e.g. "aca-standard" — the
// STABLE public identifier, never the row's own uuid, see
// service_plans.key's own schema comment) to its real row. Requires BOTH
// the plan and its service to be active — an admin toggling either off
// (service.pricing / service.edit, docs/ARCHITECTURE.md §11) takes it out
// of new-checkout circulation immediately, without needing to also delete
// the row (which existing orders' servicePlanId FK still points at).
export async function resolveServicePlan(
  planKey: string
): Promise<{ service: typeof services.$inferSelect; plan: typeof servicePlans.$inferSelect }> {
  const [row] = await db
    .select({ service: services, plan: servicePlans })
    .from(servicePlans)
    .innerJoin(services, eq(services.id, servicePlans.serviceId))
    .where(and(eq(servicePlans.key, planKey), eq(servicePlans.isActive, 'true'), eq(services.isActive, 'true')));
  if (!row) throw new CataloguePlanNotSeededError(planKey);
  return row;
}
