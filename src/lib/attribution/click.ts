import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { affiliateClicks, affiliateLinks, affiliates } from '@/db/schema';

export async function findAffiliateByReferralCode(code: string): Promise<typeof affiliates.$inferSelect | null> {
  const [affiliate] = await db.select().from(affiliates).where(eq(affiliates.referralCode, code));
  return affiliate ?? null;
}

// Links aren't pre-provisioned by affiliates in this build — one is created
// lazily the first time a click comes in for a given (affiliate, service)
// pair and reused after that.
//
// serviceId is always null for now: affiliateLinks.serviceId is a real FK
// into `services`, but the Phase 1 repository seam's catalogue is still
// static data (src/lib/repository.ts), not real rows — Phase 9 is what
// moves it into the database. Until then every link is site-wide; nothing
// downstream (conversion, commission) actually needs a per-service link to
// be correct, since commission attaches to the order/conversion, not the
// service.
async function findOrCreateLink(affiliateId: string, serviceId: string | null) {
  const condition = serviceId
    ? and(eq(affiliateLinks.affiliateId, affiliateId), eq(affiliateLinks.serviceId, serviceId))
    : and(eq(affiliateLinks.affiliateId, affiliateId), isNull(affiliateLinks.serviceId));

  const [existing] = await db.select().from(affiliateLinks).where(condition);
  if (existing) return existing;

  const [created] = await db.insert(affiliateLinks).values({ affiliateId, serviceId }).returning();
  if (!created) throw new Error('Failed to create affiliate link');
  return created;
}

export async function recordClick(params: {
  affiliateId: string;
  serviceId: string | null;
  landingPath: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ cookieId: string }> {
  const link = await findOrCreateLink(params.affiliateId, params.serviceId);
  const cookieId = randomUUID();

  await db.insert(affiliateClicks).values({
    affiliateLinkId: link.id,
    cookieId,
    landingPath: params.landingPath,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
  });

  return { cookieId };
}
