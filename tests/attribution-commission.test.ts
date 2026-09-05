import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { commissionEntries, commissionPolicies } from '@/db/schema';
import {
  recordConversion,
  cancelConversionCommission,
  reverseConversionCommission,
  getAffiliateLedgerSummary,
  OrderAlreadyAttributedError,
  ConversionNotFoundError,
} from '@/lib/attribution/commission';
import { getCurrentCommissionPolicy } from '@/lib/affiliate/commission-policy';
import { createTestAffiliate, createTestOrder, deleteTestOrder, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];
const createdOrderIds: string[] = [];
const createdPolicyIds: string[] = [];

afterEach(async () => {
  while (createdOrderIds.length) {
    const id = createdOrderIds.pop();
    if (id) await deleteTestOrder(id);
  }
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
  while (createdPolicyIds.length) {
    const id = createdPolicyIds.pop();
    if (id) await db.delete(commissionPolicies).where(eq(commissionPolicies.id, id));
  }
});

async function setCurrentPolicy(fields: Partial<typeof commissionPolicies.$inferInsert>) {
  const [policy] = await db
    .insert(commissionPolicies)
    .values({ effectiveFrom: new Date(Date.now() + 60_000), ...fields })
    .returning();
  if (!policy) throw new Error('failed to insert test commission policy');
  createdPolicyIds.push(policy.id);
  return policy;
}

describe('recordConversion', () => {
  it('creates a conversion and a PENDING EARNING entry sized from the current policy', async () => {
    await setCurrentPolicy({ commissionRateBasisPoints: 1000, holdPeriodDays: 15 }); // 10%
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, amountPaise: 1000000 }); // ₹10,000
    createdOrderIds.push(order.id);

    const { conversion, entry } = await recordConversion({ orderId: order.id, affiliateId: affiliate.id });

    expect(conversion.orderId).toBe(order.id);
    expect(entry.type).toBe('EARNING');
    expect(entry.status).toBe('PENDING');
    expect(entry.amountPaise).toBe(100000); // 10% of ₹10,000 = ₹1,000
    expect(entry.commissionRateBasisPoints).toBe(1000);
  });

  it('locks in the rate at creation time — a later policy change does not retroactively alter it', async () => {
    await setCurrentPolicy({ commissionRateBasisPoints: 1000 });
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, amountPaise: 1000000 });
    createdOrderIds.push(order.id);

    const { entry } = await recordConversion({ orderId: order.id, affiliateId: affiliate.id });
    expect(entry.amountPaise).toBe(100000);

    // Rate changes AFTER the conversion was recorded.
    await setCurrentPolicy({ commissionRateBasisPoints: 2000 }); // 20%

    const [entryRow] = await db.select().from(commissionEntries).where(eq(commissionEntries.id, entry.id));
    expect(entryRow?.amountPaise).toBe(100000); // unchanged
    expect(entryRow?.commissionRateBasisPoints).toBe(1000); // unchanged
  });

  it('refuses a second conversion for the same order — the database enforces this, not just the function', async () => {
    await setCurrentPolicy({});
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id });
    createdOrderIds.push(order.id);

    await recordConversion({ orderId: order.id, affiliateId: affiliate.id });
    await expect(recordConversion({ orderId: order.id, affiliateId: affiliate.id })).rejects.toThrow(
      OrderAlreadyAttributedError
    );

    const entries = await db
      .select()
      .from(commissionEntries)
      .where(eq(commissionEntries.affiliateId, affiliate.id));
    expect(entries.filter((e) => e.type === 'EARNING')).toHaveLength(1);
  });
});

describe('cancelConversionCommission', () => {
  it('cancels a still-PENDING earning in place — no new row', async () => {
    await setCurrentPolicy({});
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, amountPaise: 1000000, stage: 'CANCELLED' });
    createdOrderIds.push(order.id);
    const { entry } = await recordConversion({ orderId: order.id, affiliateId: affiliate.id });

    const cancelled = await cancelConversionCommission(order.id);
    expect(cancelled.id).toBe(entry.id); // same row, not a new one
    expect(cancelled.status).toBe('CANCELLED');

    const entries = await db
      .select()
      .from(commissionEntries)
      .where(eq(commissionEntries.affiliateId, affiliate.id));
    expect(entries).toHaveLength(1); // still just the one row
  });

  it('refuses to cancel an entry that has already moved past PENDING', async () => {
    await setCurrentPolicy({});
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id });
    createdOrderIds.push(order.id);
    const { entry } = await recordConversion({ orderId: order.id, affiliateId: affiliate.id });
    await db.update(commissionEntries).set({ status: 'AVAILABLE' }).where(eq(commissionEntries.id, entry.id));

    await expect(cancelConversionCommission(order.id)).rejects.toThrow(/not PENDING/);
  });

  it('throws for an order with no conversion at all', async () => {
    const { user } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id });
    createdOrderIds.push(order.id);

    await expect(cancelConversionCommission(order.id)).rejects.toThrow(ConversionNotFoundError);
  });
});

describe('reverseConversionCommission', () => {
  it('reverses the full commission on a full refund, as a new negative row — the original is untouched', async () => {
    await setCurrentPolicy({ commissionRateBasisPoints: 1000 });
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, amountPaise: 1000000 });
    createdOrderIds.push(order.id);
    const { entry } = await recordConversion({ orderId: order.id, affiliateId: affiliate.id });
    await db.update(commissionEntries).set({ status: 'PAID' }).where(eq(commissionEntries.id, entry.id));

    const reversal = await reverseConversionCommission({
      orderId: order.id,
      orderAmountPaise: 1000000,
      cumulativeAmountRefundedPaise: 1000000, // full refund
    });

    expect(reversal?.type).toBe('REVERSAL');
    expect(reversal?.status).toBe('REVERSED');
    expect(reversal?.amountPaise).toBe(-100000);
    expect(reversal?.reversalOfEntryId).toBe(entry.id);

    const [originalStillIntact] = await db.select().from(commissionEntries).where(eq(commissionEntries.id, entry.id));
    expect(originalStillIntact?.status).toBe('PAID'); // never edited
    expect(originalStillIntact?.amountPaise).toBe(100000);
  });

  it('reverses only a proportional share on a partial refund', async () => {
    await setCurrentPolicy({ commissionRateBasisPoints: 1000 });
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, amountPaise: 1000000 }); // commission = 100000
    createdOrderIds.push(order.id);
    await recordConversion({ orderId: order.id, affiliateId: affiliate.id });

    // 25% refunded so far.
    const reversal = await reverseConversionCommission({
      orderId: order.id,
      orderAmountPaise: 1000000,
      cumulativeAmountRefundedPaise: 250000,
    });

    expect(reversal?.amountPaise).toBe(-25000); // 25% of the 100000 commission

    const summary = await getAffiliateLedgerSummary(affiliate.id);
    expect(summary.netTotalPaise).toBe(100000 - 25000);
  });

  it('is idempotent: replaying the same cumulative refund figure is a no-op', async () => {
    await setCurrentPolicy({ commissionRateBasisPoints: 1000 });
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, amountPaise: 1000000 });
    createdOrderIds.push(order.id);
    await recordConversion({ orderId: order.id, affiliateId: affiliate.id });

    const first = await reverseConversionCommission({
      orderId: order.id,
      orderAmountPaise: 1000000,
      cumulativeAmountRefundedPaise: 250000,
    });
    expect(first).not.toBeNull();

    // Same webhook delivered twice (or a retried job) — must not double-reverse.
    const second = await reverseConversionCommission({
      orderId: order.id,
      orderAmountPaise: 1000000,
      cumulativeAmountRefundedPaise: 250000,
    });
    expect(second).toBeNull();

    const reversals = await db
      .select()
      .from(commissionEntries)
      .where(eq(commissionEntries.affiliateId, affiliate.id));
    expect(reversals.filter((e) => e.type === 'REVERSAL')).toHaveLength(1);
  });

  it('a second, larger refund reverses only the additional delta', async () => {
    await setCurrentPolicy({ commissionRateBasisPoints: 1000 });
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, amountPaise: 1000000 });
    createdOrderIds.push(order.id);
    await recordConversion({ orderId: order.id, affiliateId: affiliate.id });

    await reverseConversionCommission({
      orderId: order.id,
      orderAmountPaise: 1000000,
      cumulativeAmountRefundedPaise: 250000, // -25000
    });
    const second = await reverseConversionCommission({
      orderId: order.id,
      orderAmountPaise: 1000000,
      cumulativeAmountRefundedPaise: 600000, // now 60% total refunded
    });

    expect(second?.amountPaise).toBe(-35000); // (60000 - 25000) commission delta

    const summary = await getAffiliateLedgerSummary(affiliate.id);
    expect(summary.netTotalPaise).toBe(100000 - 60000);
  });
});

describe('getAffiliateLedgerSummary', () => {
  it('excludes CANCELLED entries from the net total but keeps them queryable', async () => {
    await setCurrentPolicy({ commissionRateBasisPoints: 1000 });
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);

    const goodOrder = await createTestOrder({ userId: user.id, amountPaise: 1000000 });
    createdOrderIds.push(goodOrder.id);
    await recordConversion({ orderId: goodOrder.id, affiliateId: affiliate.id });

    const cancelledOrder = await createTestOrder({ userId: user.id, amountPaise: 500000, stage: 'CANCELLED' });
    createdOrderIds.push(cancelledOrder.id);
    await recordConversion({ orderId: cancelledOrder.id, affiliateId: affiliate.id });
    await cancelConversionCommission(cancelledOrder.id);

    const summary = await getAffiliateLedgerSummary(affiliate.id);
    // Only the good order's 100000 counts — the cancelled order's 50000
    // never counted as real, despite still being a row in the ledger.
    expect(summary.netTotalPaise).toBe(100000);
  });
});
