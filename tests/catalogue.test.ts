import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { services } from '@/db/schema';
import { CataloguePlanNotSeededError, resolveServicePlan, seedCatalogueFromRepository } from '@/lib/catalogue';
import { createService, createServicePlan, updateServiceCopy, updateServicePlanDetails } from '@/lib/catalogue-admin';
import { getServicePlan } from '@/lib/repository';

beforeAll(async () => {
  await seedCatalogueFromRepository();
});

const createdServiceIds: string[] = [];
afterEach(async () => {
  while (createdServiceIds.length) {
    const id = createdServiceIds.pop();
    if (id) await db.delete(services).where(eq(services.id, id));
  }
});

describe('catalogue seed + resolver bridge (src/lib/catalogue.ts)', () => {
  it('resolves a real plan key to its seeded DB row with matching price', async () => {
    const found = await getServicePlan('aca-standard');
    expect(found).not.toBeNull();

    const { service, plan } = await resolveServicePlan('aca-standard');
    expect(service.slug).toBe('ai-content-avatar');
    expect(plan.pricePaise).toBe(found!.plan.pricePaise);
  });

  it('throws CataloguePlanNotSeededError for a key that does not exist', async () => {
    await expect(resolveServicePlan('no-such-plan-id')).rejects.toThrow(CataloguePlanNotSeededError);
  });

  it('is idempotent — reseeding does not create duplicate service rows', async () => {
    const before = await db.select().from(services).where(eq(services.slug, 'ai-content-avatar'));
    await seedCatalogueFromRepository();
    await seedCatalogueFromRepository();
    const after = await db.select().from(services).where(eq(services.slug, 'ai-content-avatar'));

    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before[0]?.id);
  });

  it('refuses to resolve a plan whose service or whose own row is inactive (taken out of new-checkout circulation)', async () => {
    const service = await createService({
      slug: `catalogue-test-${Date.now()}`,
      name: 'Catalogue Test Service',
      shortDescription: 'x',
      longDescriptionHtml: '<p/>',
    });
    createdServiceIds.push(service.id);
    const plan = await createServicePlan({
      serviceId: service.id,
      key: `catalogue-test-plan-${Date.now()}`,
      name: 'Standard',
      pricePaise: 100000,
    });

    // Still resolvable while both are active.
    const resolved = await resolveServicePlan(plan.key);
    expect(resolved.plan.id).toBe(plan.id);

    await updateServicePlanDetails(plan.id, { isActive: 'false' });
    await expect(resolveServicePlan(plan.key)).rejects.toThrow(CataloguePlanNotSeededError);

    await updateServicePlanDetails(plan.id, { isActive: 'true' });
    await updateServiceCopy(service.id, { isActive: 'false' });
    await expect(resolveServicePlan(plan.key)).rejects.toThrow(CataloguePlanNotSeededError);
  });
});
