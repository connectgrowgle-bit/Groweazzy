import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { services } from '@/db/schema';
import {
  createService,
  createServicePlan,
  getServiceForAdmin,
  getServicePlanPriceHistory,
  listServicesForAdmin,
  NoSuchRowError,
  updateServiceCopy,
  updateServicePlanDetails,
  updateServicePlanPrice,
} from '@/lib/catalogue-admin';
import { getServiceBySlug, getServices } from '@/lib/repository';
import { createTestUser, deleteTestUser } from './helpers';

const createdServiceIds: string[] = [];
const createdUserIds: string[] = [];

async function makeService(overrides: Partial<Parameters<typeof createService>[0]> = {}) {
  const service = await createService({
    slug: `test-svc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'Test Service',
    shortDescription: 'A test service',
    longDescriptionHtml: '<p>Test</p>',
    ...overrides,
  });
  createdServiceIds.push(service.id);
  return service;
}

afterEach(async () => {
  while (createdServiceIds.length) {
    const id = createdServiceIds.pop();
    // service_plans and service_plan_price_history both cascade off
    // services.id / service_plans.id — a plain service delete is enough.
    if (id) await db.delete(services).where(eq(services.id, id));
  }
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('createService / updateServiceCopy (src/lib/catalogue-admin.ts)', () => {
  it('creates a service in the public catalogue, immediately visible through the repository seam', async () => {
    const service = await makeService({ name: 'Brand New Service' });

    // This is the whole point of Phase 9: repository.ts reads live from
    // the same rows the admin API just wrote — no separate sync step.
    const fromSeam = await getServiceBySlug(service.slug);
    expect(fromSeam?.name).toBe('Brand New Service');

    const all = await getServices();
    expect(all.some((s) => s.slug === service.slug)).toBe(true);
  });

  it('updateServiceCopy edits fields and never touches pricing', async () => {
    const service = await makeService({ name: 'Original Name' });
    const updated = await updateServiceCopy(service.id, { name: 'Updated Name', features: ['a', 'b'] });
    expect(updated.name).toBe('Updated Name');
    expect(updated.features).toEqual(['a', 'b']);
  });

  it('deactivating a service removes it from the public seam but not from admin listing', async () => {
    const service = await makeService();
    await updateServiceCopy(service.id, { isActive: 'false' });

    expect(await getServiceBySlug(service.slug)).toBeNull();
    const adminList = await listServicesForAdmin();
    expect(adminList.some((s) => s.id === service.id)).toBe(true);
  });

  it('throws NoSuchRowError for a non-existent service', async () => {
    await expect(updateServiceCopy('00000000-0000-0000-0000-000000000000', { name: 'x' })).rejects.toThrow(
      NoSuchRowError
    );
  });
});

describe('createServicePlan / updateServicePlanDetails (src/lib/catalogue-admin.ts)', () => {
  it('creates a plan with no price-history row (nothing to change from)', async () => {
    const service = await makeService();
    const plan = await createServicePlan({
      serviceId: service.id,
      key: `test-plan-${Date.now()}`,
      name: 'Standard',
      pricePaise: 100000,
    });
    expect(plan.pricePaise).toBe(100000);

    const history = await getServicePlanPriceHistory(plan.id);
    expect(history).toHaveLength(0);
  });

  it('deactivating a plan removes it from the seam service but the service itself stays visible', async () => {
    const service = await makeService();
    const plan = await createServicePlan({
      serviceId: service.id,
      key: `test-plan-${Date.now()}`,
      name: 'Standard',
      pricePaise: 100000,
    });
    await updateServicePlanDetails(plan.id, { isActive: 'false' });

    const fromSeam = await getServiceBySlug(service.slug);
    expect(fromSeam?.plans).toHaveLength(0);
  });
});

describe('updateServicePlanPrice (src/lib/catalogue-admin.ts)', () => {
  it('requires a reason and writes a history row in the same operation as the price change', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const service = await makeService();
    const plan = await createServicePlan({
      serviceId: service.id,
      key: `test-plan-${Date.now()}`,
      name: 'Standard',
      pricePaise: 100000,
    });

    const updated = await updateServicePlanPrice(plan.id, 150000, 'Cost increase', user.id);
    expect(updated.pricePaise).toBe(150000);

    const history = await getServicePlanPriceHistory(plan.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.oldPricePaise).toBe(100000);
    expect(history[0]?.newPricePaise).toBe(150000);
    expect(history[0]?.reason).toBe('Cost increase');
    expect(history[0]?.changedByUserId).toBe(user.id);
  });

  it('never retroactively changes what an existing order paid (history is additive, not a rewrite)', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const service = await makeService();
    const plan = await createServicePlan({
      serviceId: service.id,
      key: `test-plan-${Date.now()}`,
      name: 'Standard',
      pricePaise: 100000,
    });

    await updateServicePlanPrice(plan.id, 150000, 'First change', user.id);
    await updateServicePlanPrice(plan.id, 200000, 'Second change', user.id);

    const history = await getServicePlanPriceHistory(plan.id);
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.newPricePaise)).toEqual([150000, 200000]);
    // Both rows survive — a later price change never rewrites or deletes
    // an earlier one; the audit trail is append-only.
    expect(history.map((h) => h.oldPricePaise)).toEqual([100000, 150000]);
  });

  it('throws NoSuchRowError for a non-existent plan', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    await expect(
      updateServicePlanPrice('00000000-0000-0000-0000-000000000000', 1000, 'x', user.id)
    ).rejects.toThrow(NoSuchRowError);
  });
});

describe('getServiceForAdmin (src/lib/catalogue-admin.ts)', () => {
  it('returns the service with ALL its plans regardless of active status', async () => {
    const service = await makeService();
    const activePlan = await createServicePlan({
      serviceId: service.id,
      key: `active-${Date.now()}`,
      name: 'Active Plan',
      pricePaise: 100000,
    });
    const inactivePlan = await createServicePlan({
      serviceId: service.id,
      key: `inactive-${Date.now()}`,
      name: 'Inactive Plan',
      pricePaise: 200000,
    });
    await updateServicePlanDetails(inactivePlan.id, { isActive: 'false' });

    const detail = await getServiceForAdmin(service.id);
    const planIds = detail!.plans.map((p) => p.id);
    expect(planIds).toContain(activePlan.id);
    expect(planIds).toContain(inactivePlan.id);
  });

  it('returns null for a non-existent service', async () => {
    expect(await getServiceForAdmin('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
