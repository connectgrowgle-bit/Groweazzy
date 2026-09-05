import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliateKyc, affiliates, payments, users } from '@/db/schema';
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

// users.id cascades to affiliates and sessions, but deliberately NOT to
// payments or affiliate_kyc.reviewed_by_user_id — those are financial/audit
// records that must survive even if the account referencing them is later
// removed, so their FKs are plain (RESTRICT), not ON DELETE CASCADE. Test
// cleanup has to unwind them in the right order for the same reason
// production never does a hard delete of a user with real payment history.
export async function deleteTestUser(userId: string) {
  const [affiliate] = await db.select().from(affiliates).where(eq(affiliates.userId, userId));
  if (affiliate) {
    await db.delete(payments).where(eq(payments.affiliateId, affiliate.id));
  }
  // This user may have reviewed KYC submissions belonging to OTHER
  // affiliates (e.g. a reviewer fixture) — null the reference rather than
  // deleting those rows, which aren't this user's to remove.
  await db.update(affiliateKyc).set({ reviewedByUserId: null }).where(eq(affiliateKyc.reviewedByUserId, userId));

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
