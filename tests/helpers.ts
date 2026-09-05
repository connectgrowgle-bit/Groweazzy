import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  affiliateConversions,
  affiliateKyc,
  affiliates,
  commissionEntries,
  orders,
  payments,
  servicePlans,
  services,
  users,
} from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';

// Every test gets its own fixture (unique email) rather than sharing rows —
// avoids cross-test interference under fileParallelism and makes each
// test's failure independently reproducible.
export async function createTestUser(overrides: { suspended?: boolean } = {}) {
  const email = `test-${randomUUID()}@example.test`;
  const password = 'a-reasonably-strong-test-password';
  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      suspendedAt: overrides.suspended ? new Date() : null,
    })
    .returning();

  if (!user) throw new Error('failed to create test user');
  return { user, email, password };
}

async function deleteOrderAndAttribution(orderId: string) {
  const [conversion] = await db.select().from(affiliateConversions).where(eq(affiliateConversions.orderId, orderId));
  if (conversion) {
    await db.delete(commissionEntries).where(eq(commissionEntries.conversionId, conversion.id));
    await db.delete(affiliateConversions).where(eq(affiliateConversions.id, conversion.id));
  }
  await db.delete(orders).where(eq(orders.id, orderId));
}

// users.id cascades to affiliates and sessions, but deliberately NOT to
// payments, affiliate_kyc.reviewed_by_user_id, or orders — those are
// financial/audit records that must survive even if the account
// referencing them is later removed, so their FKs are plain (RESTRICT), not
// ON DELETE CASCADE. Test cleanup has to unwind them in the right order for
// the same reason production never does a hard delete of a user with real
// order/payment history.
export async function deleteTestUser(userId: string) {
  const [affiliate] = await db.select().from(affiliates).where(eq(affiliates.userId, userId));
  if (affiliate) {
    await db.delete(payments).where(eq(payments.affiliateId, affiliate.id));
  }
  // This user may have reviewed KYC submissions belonging to OTHER
  // affiliates (e.g. a reviewer fixture) — null the reference rather than
  // deleting those rows, which aren't this user's to remove.
  await db.update(affiliateKyc).set({ reviewedByUserId: null }).where(eq(affiliateKyc.reviewedByUserId, userId));

  const usersOrders = await db.select().from(orders).where(eq(orders.userId, userId));
  for (const order of usersOrders) {
    await deleteOrderAndAttribution(order.id);
  }

  await db.delete(users).where(eq(users.id, userId));
}

// Bypasses registerAffiliate()'s lifecycle transition (status: REGISTERED)
// on purpose, for tests that want to start from a known status (e.g. ACTIVE)
// without exercising the full registration flow — that flow has its own
// dedicated tests.
export async function createTestAffiliate(
  overrides: Partial<typeof affiliates.$inferInsert> = {}
) {
  const { user } = await createTestUser();
  const referralCode = `GEA${Math.floor(Math.random() * 100000)
    .toString()
    .padStart(5, '0')}`;
  const [affiliate] = await db
    .insert(affiliates)
    .values({ userId: user.id, referralCode, status: 'KYC_PENDING', ...overrides })
    .returning();
  if (!affiliate) throw new Error('failed to create test affiliate');
  return { user, affiliate };
}

// A single shared service+plan fixture, created once and reused across
// every test/file that needs *an order pointing at a valid plan* without
// caring which one — the Phase 1 catalogue (src/lib/repository.ts) is
// still static data, not real DB rows (Phase 9 moves it there), so there's
// no real service/plan to reference yet outside of what tests create
// themselves. Idempotent by slug, like scripts/seed/roles-permissions.ts,
// so it's safe to leave in the test database rather than tearing it down
// per test.
export async function getOrCreateTestServicePlan() {
  const slug = 'test-fixture-service';
  let [service] = await db.select().from(services).where(eq(services.slug, slug));
  if (!service) {
    [service] = await db
      .insert(services)
      .values({ slug, name: 'Test Fixture Service', shortDescription: 'For tests only', longDescriptionHtml: '<p/>' })
      .returning();
  }
  if (!service) throw new Error('failed to create test fixture service');

  let [plan] = await db.select().from(servicePlans).where(eq(servicePlans.serviceId, service.id));
  if (!plan) {
    [plan] = await db
      .insert(servicePlans)
      .values({ serviceId: service.id, name: 'Standard', pricePaise: 1000000 })
      .returning();
  }
  if (!plan) throw new Error('failed to create test fixture service plan');

  return { service, plan };
}

// Creates a minimal order for attribution/commission tests — bypasses the
// real checkout flow (Phase 6) entirely, same spirit as
// createTestAffiliate() bypassing full registration. Defaults amountPaise
// to the fixture plan's own price but accepts an override so a test can
// exercise a specific commission calculation.
export async function createTestOrder(params: { userId: string; amountPaise?: number; stage?: string }) {
  const { plan } = await getOrCreateTestServicePlan();
  const [order] = await db
    .insert(orders)
    .values({
      userId: params.userId,
      servicePlanId: plan.id,
      amountPaise: params.amountPaise ?? plan.pricePaise,
      stage: (params.stage as typeof orders.$inferInsert.stage) ?? 'PAID',
    })
    .returning();
  if (!order) throw new Error('failed to create test order');
  return order;
}

export async function deleteTestOrder(orderId: string) {
  await deleteOrderAndAttribution(orderId);
}
