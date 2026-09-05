import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { commissionEntries, commissionPolicies, payments } from '@/db/schema';
import { recordConversion } from '@/lib/attribution/commission';
import { releaseMaturedCommissions } from '@/lib/attribution/commission-scheduler';
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

// Builds an APPROVED EARNING entry past its hold date, plus everything the
// scheduler re-verifies against (order, affiliate, a captured payment) —
// every field independently overridable so each test can break exactly one
// of those checks and nothing else. recordConversion() itself doesn't gate
// on affiliate/order state (that's resolveAttributedAffiliate's job, at
// attribution time — tests/attribution-click.test.ts), so creating the
// fixture directly with a since-changed status (e.g. affiliate SUSPENDED)
// is a faithful stand-in for "this was ACTIVE when the sale happened, then
// changed before the hold period elapsed" without needing two steps.
async function setupApprovedEntry(overrides: {
  affiliateStatus?: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED';
  orderStage?: 'PAID' | 'CANCELLED' | 'COMPLETED';
  holdReleaseAt?: Date;
  paymentStatus?: 'CAPTURED' | 'FAILED' | 'AUTHORIZED';
  amountRefundedPaise?: number;
  amountPaise?: number;
} = {}) {
  const { user, affiliate } = await createTestAffiliate({ status: overrides.affiliateStatus ?? 'ACTIVE' });
  createdUserIds.push(user.id);
  const amountPaise = overrides.amountPaise ?? 1000000;
  const order = await createTestOrder({ userId: user.id, amountPaise, stage: overrides.orderStage ?? 'PAID' });
  createdOrderIds.push(order.id);

  await db.insert(payments).values({
    purpose: 'SERVICE_ORDER',
    orderId: order.id,
    amountPaise,
    amountRefundedPaise: overrides.amountRefundedPaise ?? 0,
    status: overrides.paymentStatus ?? 'CAPTURED',
    razorpayOrderId: `order_test_${randomUUID()}`,
  });

  // Same "definitely newer than anything else" trick
  // tests/attribution-commission.test.ts uses — getCurrentCommissionPolicy()
  // picks whichever row has the latest effectiveFrom, so this guarantees
  // this fixture's own policy wins regardless of what other tests (or a
  // real seed) already inserted.
  const [policy] = await db
    .insert(commissionPolicies)
    .values({ commissionRateBasisPoints: 1000, effectiveFrom: new Date(Date.now() + 60_000) })
    .returning();
  if (!policy) throw new Error('failed to insert test commission policy');
  createdPolicyIds.push(policy.id);

  const { entry } = await recordConversion({ orderId: order.id, affiliateId: affiliate.id });

  const [approved] = await db
    .update(commissionEntries)
    .set({ status: 'APPROVED', holdReleaseAt: overrides.holdReleaseAt ?? new Date(Date.now() - 1000) })
    .where(eq(commissionEntries.id, entry.id))
    .returning();
  if (!approved) throw new Error('failed to set up test commission entry');

  return { user, affiliate, order, entry: approved };
}

async function reload(entryId: string) {
  const [row] = await db.select().from(commissionEntries).where(eq(commissionEntries.id, entryId));
  if (!row) throw new Error(`entry ${entryId} vanished`);
  return row;
}

describe('releaseMaturedCommissions', () => {
  it('releases an APPROVED entry past its hold date to AVAILABLE', async () => {
    const { entry } = await setupApprovedEntry();

    const summary = await releaseMaturedCommissions();

    expect(summary.released).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.failed).toBe(0);
    expect((await reload(entry.id)).status).toBe('AVAILABLE');
  });

  it('does not touch an entry whose hold period has not elapsed yet', async () => {
    const { entry } = await setupApprovedEntry({ holdReleaseAt: new Date(Date.now() + 60 * 60 * 1000) });

    const summary = await releaseMaturedCommissions();

    expect(summary.examined).toBe(0);
    expect((await reload(entry.id)).status).toBe('APPROVED');
  });

  it('never releases a still-PENDING entry, even past its hold date — payment was never confirmed captured', async () => {
    const { entry } = await setupApprovedEntry();
    await db.update(commissionEntries).set({ status: 'PENDING' }).where(eq(commissionEntries.id, entry.id));

    const summary = await releaseMaturedCommissions();

    expect(summary.examined).toBe(0);
    expect((await reload(entry.id)).status).toBe('PENDING');
  });

  it('skips (leaves APPROVED) when the affiliate has since been suspended', async () => {
    const { entry } = await setupApprovedEntry({ affiliateStatus: 'SUSPENDED' });

    const summary = await releaseMaturedCommissions();

    expect(summary.released).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(summary.notes[0]).toContain('SUSPENDED');
    expect((await reload(entry.id)).status).toBe('APPROVED');
  });

  it('skips when the order has since been cancelled', async () => {
    const { entry } = await setupApprovedEntry({ orderStage: 'CANCELLED' });

    const summary = await releaseMaturedCommissions();

    expect(summary.skipped).toBe(1);
    expect(summary.notes[0]).toContain('cancelled');
    expect((await reload(entry.id)).status).toBe('APPROVED');
  });

  it('skips when the payment has been fully refunded — a refund never edits the EARNING row itself', async () => {
    const { entry } = await setupApprovedEntry({ amountPaise: 1000000, amountRefundedPaise: 1000000 });

    const summary = await releaseMaturedCommissions();

    expect(summary.skipped).toBe(1);
    expect(summary.notes[0]).toContain('fully refunded');
    expect((await reload(entry.id)).status).toBe('APPROVED');
  });

  it('still releases when only PARTIALLY refunded — the separate REVERSAL row already accounts for the difference', async () => {
    const { entry } = await setupApprovedEntry({ amountPaise: 1000000, amountRefundedPaise: 250000 });

    const summary = await releaseMaturedCommissions();

    expect(summary.released).toBe(1);
    expect((await reload(entry.id)).status).toBe('AVAILABLE');
  });

  it('never touches an entry a payout has already claimed', async () => {
    const { entry } = await setupApprovedEntry();
    await db.update(commissionEntries).set({ payoutId: randomUUID() }).where(eq(commissionEntries.id, entry.id));

    const summary = await releaseMaturedCommissions();

    expect(summary.examined).toBe(0);
    expect((await reload(entry.id)).status).toBe('APPROVED');
  });

  it('is idempotent — a second run finds nothing left to do', async () => {
    const { entry } = await setupApprovedEntry();

    await releaseMaturedCommissions();
    const second = await releaseMaturedCommissions();

    expect(second.examined).toBe(0);
    expect((await reload(entry.id)).status).toBe('AVAILABLE');
  });

  it('one bad entry does not stop the rest of the run from releasing', async () => {
    const { entry: goodEntry } = await setupApprovedEntry();
    const { entry: suspendedEntry } = await setupApprovedEntry({ affiliateStatus: 'SUSPENDED' });

    const summary = await releaseMaturedCommissions();

    expect(summary.examined).toBe(2);
    expect(summary.released).toBe(1);
    expect(summary.skipped).toBe(1);
    expect((await reload(goodEntry.id)).status).toBe('AVAILABLE');
    expect((await reload(suspendedEntry.id)).status).toBe('APPROVED');
  });
});
