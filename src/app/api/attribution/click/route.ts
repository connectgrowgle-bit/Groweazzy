import { NextResponse } from 'next/server';
import { findAffiliateByReferralCode, recordClick } from '@/lib/attribution/click';
import { attributionCookieOptions, ATTRIBUTION_COOKIE_NAME, signAttributionCookie } from '@/lib/attribution/cookie';
import { safeInternalPath } from '@/lib/safe-redirect';

// Handed off from middleware.ts whenever a page request carries `?ref=`.
// Always lands on `next` — the ref param must never survive to the
// browser's address bar, whether or not it turns out to name a real
// affiliate (a bogus/typo'd code should just render the page normally, not
// error or leave the tracking param sitting in the URL).
//
// This route is independently, publicly reachable (it's a normal API
// route, not something only middleware can call) — a request crafted
// directly with `next=https://evil.com` bypasses middleware's own
// same-origin `next` construction entirely, and `new URL(next, origin)`
// happily returns that OTHER origin verbatim when `next` is already an
// absolute URL (the `base` argument is only a fallback, not a constraint).
// safeInternalPath forces `next` back to a same-origin relative path
// before it ever reaches the URL constructor — this was a real, exploitable
// open redirect (docs/ARCHITECTURE.md §27), not a defensive nicety.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ref = url.searchParams.get('ref');
  const nextParam = safeInternalPath(url.searchParams.get('next'), '/');
  const redirectUrl = new URL(nextParam, url.origin);

  const response = NextResponse.redirect(redirectUrl);

  if (ref) {
    const affiliate = await findAffiliateByReferralCode(ref);
    // Click tracking itself is permissive (any registered, non-terminated
    // affiliate) — the stricter "must be ACTIVE to actually earn" check
    // happens later, at conversion time (src/lib/attribution/resolve.ts),
    // since an affiliate mid-KYC should still be able to test their own
    // link works.
    if (affiliate && affiliate.status !== 'TERMINATED') {
      const { cookieId } = await recordClick({
        affiliateId: affiliate.id,
        serviceId: null, // see src/lib/attribution/click.ts's note on why
        landingPath: redirectUrl.pathname,
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
        userAgent: request.headers.get('user-agent') ?? undefined,
      });
      response.cookies.set(ATTRIBUTION_COOKIE_NAME, signAttributionCookie(cookieId), attributionCookieOptions());
    }
  }

  return response;
}
