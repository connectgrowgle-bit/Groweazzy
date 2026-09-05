import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliateConversions, commissionEntries, orders } from '@/db/schema';
import { getCurrentCommissionPolicy } from '@/lib/affiliate/commission-policy';
import { isUniqueViolation } from '@/lib/db-errors';

export class OrderAlreadyAttributedError extends Error {
  constructor() {
    super('This order already has a conversion recorded');
    this.name = 'OrderAlreadyAttributedError';
  }
}

// Called once, when an order is placed with a resolved attribution (Phase 6
// wires this to real checkout via resolveAttributedAffiliate()). Creates
// the conversion and a PENDING EARNING commission entry sized from the
// CURRENT policy — the rate is locked into the entry's own
// commissionRateBasisPoints column at creation time, so a later policy
// change never retroactively changes what this specific conversion earned
// (docs/ARCHITECTURE.md §13 D-3, D-5).
//
// "One EARNING per conversion" and "one conversion per order" are enforced
// by the database (drizzle/manual/0001_partial_indexes.sql and the schema's
// own unique index), not just this function's control flow — a concurrent
// duplicate call surfaces as OrderAlreadyAttributedError, not a second row.
export async function recordConversion(params: {
  orderId: string;
  affiliateId: string;
}): Promise<{ conversion: typeof affiliateConversions.$inferSelect; entry: typeof commissionEntries.$inferSelect }> {
  const [order] = await db.select().from(orders).where(eq(orders.id, params.orderId));
  if (!order) throw new Error(`No such order: ${params.orderId}`);

  const policy = await getCurrentCommissionPolicy();
  const amountPaise = Math.round((order.amountPaise * policy.commissionRateBasisPoints) / 10000);
  const holdReleaseAt = new Date(Date.now() + policy.holdPeriodDays * 24 * 60 * 60 * 1000);

  try {
    const [conversion] = await db
      .insert(affiliateConversions)
      .values({ affiliateId: params.affiliateId, orderId: params.orderId })
      .returning();
    if (!conversion) throw new Error('Insert did not return a row');

    const [entry] = await db
      .insert(commissionEntries)
      .values({
        affiliateId: params.affiliateId,
        conversionId: conversion.id,
        type: 'EARNING',
        status: 'PENDING',
        amountPaise,
        commissionRateBasisPoints: policy.commissionRateBasisPoints,
        holdReleaseAt,
      })
      .returning();
    if (!entry) throw new Error('Insert did not return a row');

    return { conversion, entry };
  } catch (err) {
    if (isUniqueViolation(err, 'affiliate_conversions_order_uidx')) {
      throw new OrderAlreadyAttributedError();
    }
    throw err;
  }
}

export class ConversionNotFoundError extends Error {
  constructor(orderId: string) {
    super(`No conversion recorded for order: ${orderId}`);
    this.name = 'ConversionNotFoundError';
  }
}

async function getConversionAndEarningForOrder(orderId: string) {
  const [conversion] = await db.select().from(affiliateConversions).where(eq(affiliateConversions.orderId, orderId));
  if (!conversion) throw new ConversionNotFoundError(orderId);

  const [earning] = await db
    .select()
    .from(commissionEntries)
    .where(and(eq(commissionEntries.conversionId, conversion.id), eq(commissionEntries.type, 'EARNING')));
  if (!earning) throw new Error(`Conversion ${conversion.id} has no EARNING entry — data inconsistency`);

  return { conversion, earning };
}

// The order never completed, so nothing was ever really earned — this is a
// status change on the still-PENDING placeholder row, not a new negative
// row. CANCELLED and REVERSED are not the same idea under different names
// (docs/ARCHITECTURE.md §6): refuses to cancel anything past PENDING,
// because reaching APPROVED/AVAILABLE/PAID means the order DID complete at
// some point, and the correct tool for money clawed back after that is
// reverseConversionCommission, not a silent cancel that erases the fact
// real money was involved.
export async function cancelConversionCommission(orderId: string): Promise<typeof commissionEntries.$inferSelect> {
  const { earning } = await getConversionAndEarningForOrder(orderId);
  if (earning.status !== 'PENDING') {
    throw new Error(
      `Cannot cancel commission entry ${earning.id}: status is ${earning.status}, not PENDING. ` +
        'Use reverseConversionCommission for an order that had already completed.'
    );
  }

  const [updated] = await db
    .update(commissionEntries)
    .set({ status: 'CANCELLED' })
    .where(eq(commissionEntries.id, earning.id))
    .returning();
  if (!updated) throw new Error('Update did not return a row');
  return updated;
}

// The order DID complete — a captured payment produced this earning — and
// is now being partially or fully refunded. Reverses a PROPORTIONAL share
// of the original commission, computed from the gateway's own CUMULATIVE
// refunded-so-far figure (docs/ARCHITECTURE.md §6, §9-style mistake #8 in
// the original brief: "partial refunds reversed the entire commission").
//
// Crucially, this is idempotent against replay: it computes what SHOULD
// have been reversed by now from `cumulativeAmountRefundedPaise`, compares
// that to what the ledger shows has ALREADY been reversed for this
// conversion (summed from existing REVERSAL rows — not a separate counter),
// and only inserts a new row for the difference. Calling this twice with
// the same cumulative figure (e.g. a replayed webhook) is a safe no-op, and
// calling it again later with a larger cumulative figure (a second partial
// refund) reverses only the additional delta. The original EARNING row is
// never edited.
export async function reverseConversionCommission(params: {
  orderId: string;
  orderAmountPaise: number;
  cumulativeAmountRefundedPaise: number;
}): Promise<typeof commissionEntries.$inferSelect | null> {
  const { conversion, earning } = await getConversionAndEarningForOrder(params.orderId);

  if (params.cumulativeAmountRefundedPaise <= 0) return null;
  if (params.cumulativeAmountRefundedPaise > params.orderAmountPaise) {
    throw new Error('cumulativeAmountRefundedPaise cannot exceed orderAmountPaise');
  }

  const targetReversedPaise = Math.round(
    (earning.amountPaise * params.cumulativeAmountRefundedPaise) / params.orderAmountPaise
  );

  const existingReversals = await db
    .select()
    .from(commissionEntries)
    .where(and(eq(commissionEntries.conversionId, conversion.id), eq(commissionEntries.type, 'REVERSAL')));
  const alreadyReversedPaise = existingReversals.reduce((sum, row) => sum + -row.amountPaise, 0);

  const deltaPaise = targetReversedPaise - alreadyReversedPaise;
  if (deltaPaise <= 0) return null; // already fully accounted for

  const [reversal] = await db
    .insert(commissionEntries)
    .values({
      affiliateId: earning.affiliateId,
      conversionId: conversion.id,
      type: 'REVERSAL',
      status: 'REVERSED',
      amountPaise: -deltaPaise,
      commissionRateBasisPoints: earning.commissionRateBasisPoints,
      reversalOfEntryId: earning.id,
    })
    .returning();
  if (!reversal) throw new Error('Insert did not return a row');
  return reversal;
}

// Balance is always SUM() over the ledger, computed on read — never a
// stored/incremented column (docs/ARCHITECTURE.md §6).
export async function getAffiliateLedgerSummary(affiliateId: string) {
  const rows = await db.select().from(commissionEntries).where(eq(commissionEntries.affiliateId, affiliateId));

  const sumWhere = (predicate: (row: (typeof rows)[number]) => boolean) =>
    rows.filter(predicate).reduce((sum, row) => sum + row.amountPaise, 0);

  return {
    pendingPaise: sumWhere((r) => r.status === 'PENDING'),
    approvedPaise: sumWhere((r) => r.status === 'APPROVED'),
    availablePaise: sumWhere((r) => r.status === 'AVAILABLE'),
    paidPaise: sumWhere((r) => r.status === 'PAID'),
    // Lifetime net across everything EXCEPT cancelled entries — a CANCELLED
    // row still carries its original (positive) amountPaise for audit
    // ("we would have earned X"), but that money was never real and must
    // not count toward any total. Earnings still in PENDING/APPROVED count
    // (they represent real, captured-payment money working through the
    // hold period); REVERSAL rows are already negative and net out
    // whatever they're reversing.
    netTotalPaise: sumWhere((r) => r.status !== 'CANCELLED'),
  };
}
