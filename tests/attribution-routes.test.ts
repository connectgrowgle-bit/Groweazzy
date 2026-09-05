import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliateClicks, affiliateLinks } from '@/db/schema';
import { verifyAttributionCookie } from '@/lib/attribution/cookie';
import { createTestAffiliate, deleteTestUser } from './helpers';
import { TEST_SERVER_URL } from './global-setup';

const BASE_URL = TEST_SERVER_URL;
const createdUserIds: string[] = [];

afterAll(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

function extractCookieHeader(res: Response, name: string): string | undefined {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const match = setCookies.find((c) => c.startsWith(`${name}=`));
  return match?.split(';')[0]?.slice(name.length + 1);
}

describe('attribution routes (real server, real Postgres)', () => {
  it('visiting a page with ?ref= redirects to the clean URL and sets a signed attribution cookie', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);

    const res = await fetch(`${BASE_URL}/pricing?ref=${affiliate.referralCode}`, { redirect: 'manual' });

    // Two hops in Next: middleware -> /api/attribution/click -> final clean
    // URL. `redirect: 'manual'` stops fetch from following either, so we
    // only see the first hop here — enough to prove the ref param never
    // reaches the final rendered page (asserted by chasing it manually
    // below) and that middleware handed off rather than rendering directly.
    expect(res.status).toBe(307);
    const firstHop = res.headers.get('location');
    expect(firstHop).toContain('/api/attribution/click');
    expect(firstHop).toContain(`ref=${affiliate.referralCode}`);

    const clickRes = await fetch(new URL(firstHop!, BASE_URL), { redirect: 'manual' });
    expect(clickRes.status).toBe(307);
    const finalLocation = clickRes.headers.get('location');
    expect(finalLocation).not.toContain('ref=');
    expect(new URL(finalLocation!, BASE_URL).pathname).toBe('/pricing');

    const cookieValue = extractCookieHeader(clickRes, 'ge_ref');
    expect(cookieValue).toBeDefined();
    const cookieId = verifyAttributionCookie(cookieValue!);
    expect(cookieId).not.toBeNull();

    const [click] = await db.select().from(affiliateClicks).where(eq(affiliateClicks.cookieId, cookieId!));
    expect(click).toBeDefined();
    expect(click?.landingPath).toBe('/pricing');

    const [link] = await db.select().from(affiliateLinks).where(eq(affiliateLinks.id, click!.affiliateLinkId));
    expect(link?.affiliateId).toBe(affiliate.id);
  });

  it('a bogus referral code still redirects cleanly and does not set a cookie', async () => {
    const clickRes = await fetch(`${BASE_URL}/api/attribution/click?ref=GEA00000&next=%2Fabout`, {
      redirect: 'manual',
    });
    expect(clickRes.status).toBe(307);
    expect(clickRes.headers.get('location')).toContain('/about');
    expect(extractCookieHeader(clickRes, 'ge_ref')).toBeUndefined();
  });

  it('a request with no ?ref= at all passes straight through — no redirect', async () => {
    const res = await fetch(`${BASE_URL}/pricing`, { redirect: 'manual' });
    expect(res.status).toBe(200);
  });

  // This route is independently, publicly reachable (not only middleware
  // can call it) — a `next` crafted to look like an absolute external URL
  // must never survive into the redirect target (docs/ARCHITECTURE.md
  // §27: this was a real, exploitable open redirect, not a defensive
  // nicety — new URL(next, origin) returns the OTHER origin verbatim when
  // `next` already looks absolute, silently ignoring the base).
  it('a `next` crafted as an absolute external URL is not followed — redirects to "/" instead', async () => {
    const res = await fetch(`${BASE_URL}/api/attribution/click?next=https%3A%2F%2Fevil.example%2Fphish`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!, BASE_URL);
    expect(location.origin).toBe(BASE_URL);
    expect(location.pathname).toBe('/');
  });

  it('a `next` crafted as a protocol-relative URL ("//host") is not followed either', async () => {
    const res = await fetch(`${BASE_URL}/api/attribution/click?next=%2F%2Fevil.example%2Fphish`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!, BASE_URL);
    expect(location.origin).toBe(BASE_URL);
    expect(location.pathname).toBe('/');
  });
});
