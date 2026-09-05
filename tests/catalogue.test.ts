import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { services } from '@/db/schema';
import { CataloguePlanNotSeededError, resolveServicePlan, seedCatalogueFromRepository } from '@/lib/catalogue';
import { getServicePlan } from '@/lib/repository';

beforeAll(async () => {
  await seedCatalogueFromRepository();
});

describe('catalogue seed + resolver bridge (src/lib/catalogue.ts)', () => {
  it('resolves a real static plan id to a seeded DB row with matching price', async () => {
    const staticFound = await getServicePlan('aca-standard');
    expect(staticFound).not.toBeNull();

    const { service, plan } = await resolveServicePlan('aca-standard');
    expect(service.slug).toBe('ai-content-avatar');
    expect(plan.pricePaise).toBe(staticFound!.plan.pricePaise);
  });

  it('throws CataloguePlanNotSeededError for an id with no static entry', async () => {
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
});
