import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliates, commissionEntries, payments, users } from '@/db/schema';

export type RevenueSummary = {
  serviceRevenueNetPaise: number;
  affiliateFeeRevenueNetPaise: number;
  totalRevenueNetPaise: number;
  capturedOrderPaymentCount: number;
  commissionPaidOutPaise: number;
  commissionAvailablePaise: number; // APPROVED or AVAILABLE — earned, not yet paid out
};

// "Revenue metrics count only CAPTURED payments with refunds subtracted,
// and nothing is cached — every admin-facing number is summed from source
// rows on read" (docs/ARCHITECTURE.md §11). A cached number that is wrong
// looks exactly like a correct one, so this queries fresh on every call —
// no memoization, no materialized view, nothing this function itself
// holds onto between requests.
//
// A payment's own `status` column stays CAPTURED even after a partial or
// full refund (only `amountRefundedPaise` moves — see
// src/lib/payments/order-webhooks.ts's handleServiceOrderPaymentRefund) —
// so filtering on CAPTURED and subtracting amountRefundedPaise is already
// the complete, correct net figure; there is no separate REFUNDED/
// PARTIALLY_REFUNDED status this codebase ever actually sets to also
// handle.
export async function getRevenueSummary(): Promise<RevenueSummary> {
  const captured = await db.select().from(payments).where(eq(payments.status, 'CAPTURED'));

  let serviceRevenueNetPaise = 0;
  let affiliateFeeRevenueNetPaise = 0;
  let capturedOrderPaymentCount = 0;
  for (const p of captured) {
    const net = p.amountPaise - p.amountRefundedPaise;
    if (p.purpose === 'SERVICE_ORDER') {
      serviceRevenueNetPaise += net;
      capturedOrderPaymentCount += 1;
    } else {
      affiliateFeeRevenueNetPaise += net;
    }
  }

  // Commission ledger: summing amountPaise directly is correct net —
  // REVERSAL rows are already negative (docs/ARCHITECTURE.md §6), and a
  // CANCELLED entry is excluded outright since CANCELLED means "this
  // never should have counted" (an in-place status change, not a new
  // negative row — the pre-payment cancel case, §6/§23), not "this
  // counted and was then undone."
  const commissionRows = await db.select().from(commissionEntries);
  let commissionPaidOutPaise = 0;
  let commissionAvailablePaise = 0;
  for (const c of commissionRows) {
    if (c.status === 'CANCELLED') continue;
    if (c.status === 'PAID') commissionPaidOutPaise += c.amountPaise;
    if (c.status === 'APPROVED' || c.status === 'AVAILABLE') commissionAvailablePaise += c.amountPaise;
  }

  return {
    serviceRevenueNetPaise,
    affiliateFeeRevenueNetPaise,
    totalRevenueNetPaise: serviceRevenueNetPaise + affiliateFeeRevenueNetPaise,
    capturedOrderPaymentCount,
    commissionPaidOutPaise,
    commissionAvailablePaise,
  };
}

export type AffiliatePerformanceRow = {
  affiliateId: string;
  referralCode: string;
  email: string;
  netCommissionPaise: number;
  conversionCount: number;
};

// report.affiliate.view — ranks affiliates by net commission (same
// CANCELLED-excluded, REVERSAL-inclusive sum as getRevenueSummary above),
// summed fresh from the ledger every call.
export async function getAffiliatePerformance(): Promise<AffiliatePerformanceRow[]> {
  const rows = await db
    .select({ affiliate: affiliates, email: users.email })
    .from(affiliates)
    .innerJoin(users, eq(users.id, affiliates.userId));

  const entries = await db.select().from(commissionEntries);
  const netByAffiliate = new Map<string, number>();
  const conversionsByAffiliate = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.status === 'CANCELLED') continue;
    netByAffiliate.set(entry.affiliateId, (netByAffiliate.get(entry.affiliateId) ?? 0) + entry.amountPaise);
    const set = conversionsByAffiliate.get(entry.affiliateId) ?? new Set<string>();
    set.add(entry.conversionId);
    conversionsByAffiliate.set(entry.affiliateId, set);
  }

  return rows
    .map(({ affiliate, email }) => ({
      affiliateId: affiliate.id,
      referralCode: affiliate.referralCode,
      email,
      netCommissionPaise: netByAffiliate.get(affiliate.id) ?? 0,
      conversionCount: conversionsByAffiliate.get(affiliate.id)?.size ?? 0,
    }))
    .filter((row) => row.conversionCount > 0)
    .sort((a, b) => b.netCommissionPaise - a.netCommissionPaise);
}
