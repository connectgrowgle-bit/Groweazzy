import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliateClicks, affiliateLinks } from '@/db/schema';
import { findAffiliateByReferralCode, recordClick } from '@/lib/attribution/click';
import { createTestAffiliate, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('attribution click recording', () => {
  it('finds an affiliate by referral code', async () => {
    const { user, affiliate } = await createTestAffiliate();
    createdUserIds.push(user.id);

    const found = await findAffiliateByReferralCode(affiliate.referralCode);
    expect(found?.id).toBe(affiliate.id);
  });

  it('returns null for an unknown referral code', async () => {
    expect(await findAffiliateByReferralCode('GEA99999')).toBeNull();
  });

  it('records a click and creates a site-wide link on first use', async () => {
    const { user, affiliate } = await createTestAffiliate();
    createdUserIds.push(user.id);

    const { cookieId } = await recordClick({
      affiliateId: affiliate.id,
      serviceId: null,
      landingPath: '/ai-content-avatar',
    });

    const [link] = await db.select().from(affiliateLinks).where(eq(affiliateLinks.affiliateId, affiliate.id));
    expect(link).toBeDefined();
    expect(link?.serviceId).toBeNull();

    const [click] = await db.select().from(affiliateClicks).where(eq(affiliateClicks.cookieId, cookieId));
    expect(click?.affiliateLinkId).toBe(link!.id);
    expect(click?.landingPath).toBe('/ai-content-avatar');
  });

  it('reuses the same site-wide link across multiple clicks instead of creating a new one each time', async () => {
    const { user, affiliate } = await createTestAffiliate();
    createdUserIds.push(user.id);

    await recordClick({ affiliateId: affiliate.id, serviceId: null, landingPath: '/pricing' });
    await recordClick({ affiliateId: affiliate.id, serviceId: null, landingPath: '/services' });

    const links = await db.select().from(affiliateLinks).where(eq(affiliateLinks.affiliateId, affiliate.id));
    expect(links).toHaveLength(1);

    const clicks = await db.select().from(affiliateClicks).where(eq(affiliateClicks.affiliateLinkId, links[0]!.id));
    expect(clicks).toHaveLength(2);
  });

  it('each click gets its own unique cookieId', async () => {
    const { user, affiliate } = await createTestAffiliate();
    createdUserIds.push(user.id);

    const a = await recordClick({ affiliateId: affiliate.id, serviceId: null, landingPath: '/a' });
    const b = await recordClick({ affiliateId: affiliate.id, serviceId: null, landingPath: '/b' });
    expect(a.cookieId).not.toBe(b.cookieId);
  });
});
