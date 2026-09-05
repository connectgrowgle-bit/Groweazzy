import { and, eq, isNull, lte } from 'drizzle-orm';
import { db } from '@/db';
import { affiliateConversions, affiliates, commissionEntries, orders, payments } from '@/db/schema';

export type ReleaseSummary = {
  examined: number;
  released: number;
  skipped: number;
  failed: number;
  notes: string[];
};

// The other half of the pipeline src/lib/payments/order-webhooks.ts already
// drives: a captured payment moves an EARNING PENDING -> APPROVED (real
// money landed), and this is what later moves APPROVED -> AVAILABLE once
// its hold period (commission_policies.holdPeriodDays, locked in at
// recordConversion time via holdReleaseAt) has actually elapsed. Never acts
// on a still-PENDING entry — PENDING specifically means "payment not yet
// confirmed captured," and releasing one of those would mean paying out on
// an order nobody has actually paid for.
//
// docs/ARCHITECTURE.md §12: does not release everything past its hold
// date — every candidate is re-verified from source, not trusted from
// whatever was true when it became APPROVED, because all of the following
// can change during the hold window: the affiliate can be suspended, the
// order can be cancelled, the payment can be refunded (in full or in
// part). None of those retroactively edit the EARNING row itself — a
// refund creates its own separate REVERSAL row (reverseConversionCommission)
// and never touches this one — so a stale check here would happily release
// (and eventually pay) money that has since been clawed back. A candidate
// that fails re-verification is simply left at APPROVED, not force-moved
// to any terminal status: most of these conditions (suspension, a refund
// still being processed) can resolve themselves, and the next scheduled
// run re-examines it exactly like the first time.
export async function releaseMaturedCommissions(now: Date = new Date()): Promise<ReleaseSummary> {
  const candidates = await db
    .select({ id: commissionEntries.id })
    .from(commissionEntries)
    .where(
      and(
        eq(commissionEntries.type, 'EARNING'),
        eq(commissionEntries.status, 'APPROVED'),
        lte(commissionEntries.holdReleaseAt, now),
        isNull(commissionEntries.payoutId)
      )
    );

  const summary: ReleaseSummary = { examined: candidates.length, released: 0, skipped: 0, failed: 0, notes: [] };

  for (const { id } of candidates) {
    try {
      const outcome = await releaseOneEntry(id);
      if (outcome) {
        if (outcome.released) summary.released += 1;
        else {
          summary.skipped += 1;
          summary.notes.push(outcome.reason);
        }
      }
      // outcome === null: the row no longer matched by the time this
      // specific entry's own transaction re-checked it (raced by something
      // else mid-run, e.g. an admin action) — a silent no-op, not counted
      // as a skip, matching §12's "no-op instead of a race."
    } catch (err) {
      summary.failed += 1;
      summary.notes.push(`entry ${id}: unexpected error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return summary;
}

// Every re-verification happens INSIDE the same transaction that holds the
// entry's row lock, each read taken fresh (never reused from the outer
// candidate-selection query above) — so a concurrent change that commits
// before this transaction's own reads run is always seen, and one that
// commits after is correctly left for the next scheduled run rather than
// racing this one.
async function releaseOneEntry(entryId: string): Promise<{ released: true } | { released: false; reason: string } | null> {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(commissionEntries)
      .where(
        and(
          eq(commissionEntries.id, entryId),
          eq(commissionEntries.type, 'EARNING'),
          eq(commissionEntries.status, 'APPROVED'),
          isNull(commissionEntries.payoutId)
        )
      )
      .for('update');
    if (!entry) return null;

    const [conversion] = await tx
      .select()
      .from(affiliateConversions)
      .where(eq(affiliateConversions.id, entry.conversionId));
    if (!conversion) return { released: false, reason: `entry ${entryId}: no conversion row — data inconsistency` };

    const [order] = await tx.select().from(orders).where(eq(orders.id, conversion.orderId));
    if (!order) return { released: false, reason: `entry ${entryId}: no order row — data inconsistency` };
    if (order.stage === 'CANCELLED') return { released: false, reason: `entry ${entryId}: order ${order.id} is cancelled` };

    const [affiliate] = await tx.select().from(affiliates).where(eq(affiliates.id, entry.affiliateId));
    if (!affiliate || affiliate.status !== 'ACTIVE') {
      return { released: false, reason: `entry ${entryId}: affiliate is ${affiliate?.status ?? 'missing'}, not ACTIVE` };
    }

    // Locked alongside the entry — closes the (narrow, non-adversarial)
    // window where a refund webhook's own update to this same row is
    // in-flight but not yet committed at the instant this read runs.
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.purpose, 'SERVICE_ORDER')))
      .for('update');
    if (!payment || payment.status !== 'CAPTURED') {
      return { released: false, reason: `entry ${entryId}: payment is ${payment?.status ?? 'missing'}, not CAPTURED` };
    }
    // payments.status never actually moves to REFUNDED/PARTIALLY_REFUNDED
    // in this codebase (src/lib/admin/revenue.ts's own comment) — a refund
    // only ever moves amountRefundedPaise, so that is the real "still
    // owed" check, not the status column.
    if (payment.amountRefundedPaise >= payment.amountPaise) {
      return { released: false, reason: `entry ${entryId}: payment fully refunded` };
    }

    const [updated] = await tx
      .update(commissionEntries)
      .set({ status: 'AVAILABLE' })
      .where(and(eq(commissionEntries.id, entryId), eq(commissionEntries.status, 'APPROVED')))
      .returning({ id: commissionEntries.id });
    if (!updated) return null; // raced between the SELECT ... FOR UPDATE above and this write — vanishingly unlikely, but never assume

    return { released: true };
  });
}
