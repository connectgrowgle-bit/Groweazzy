import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliateClicks, affiliateLinks, affiliates } from '@/db/schema';
import { getAttributionCookieId } from './cookie';

// Resolves the current request's attribution cookie back to an affiliate —
// used wherever an order is placed (Phase 6) to decide who, if anyone, gets
// credit for the sale. Only an ACTIVE affiliate earns: a click cookie can
// easily outlive a KYC rejection, suspension, or termination that happened
// after the click but before the eventual purchase, and none of those
// should retroactively become a payable commission.
export async function resolveAttributedAffiliate(): Promise<typeof affiliates.$inferSelect | null> {
  const cookieId = await getAttributionCookieId();
  if (!cookieId) return null;

  const rows = await db
    .select({ affiliate: affiliates })
    .from(affiliateClicks)
    .innerJoin(affiliateLinks, eq(affiliateLinks.id, affiliateClicks.affiliateLinkId))
    .innerJoin(affiliates, eq(affiliates.id, affiliateLinks.affiliateId))
    .where(eq(affiliateClicks.cookieId, cookieId));

  const row = rows[0];
  if (!row) return null;
  if (row.affiliate.status !== 'ACTIVE') return null;

  return row.affiliate;
}
