import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';

// A signed (not encrypted — the cookieId itself isn't secret) cookie
// carrying a click's cookieId, so a visitor can't forge attribution to an
// affiliate by hand-crafting a cookie value. Signed with SESSION_SECRET via
// HMAC-SHA256, verified with a constant-time comparison.
export const ATTRIBUTION_COOKIE_NAME = 'ge_ref';
export const ATTRIBUTION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30-day attribution window

export function signAttributionCookie(cookieId: string): string {
  const env = getEnv();
  const mac = createHmac('sha256', env.SESSION_SECRET).update(cookieId).digest('hex');
  return `${cookieId}.${mac}`;
}

export function verifyAttributionCookie(signed: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const cookieId = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);

  const env = getEnv();
  const expectedMac = createHmac('sha256', env.SESSION_SECRET).update(cookieId).digest('hex');

  const macBuf = Buffer.from(mac, 'hex');
  const expectedBuf = Buffer.from(expectedMac, 'hex');
  if (mac.length === 0 || macBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(macBuf, expectedBuf)) return null;

  return cookieId;
}

export function attributionCookieOptions(env = getEnv()) {
  return {
    httpOnly: true,
    secure: env.APP_ENV !== 'development',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: ATTRIBUTION_COOKIE_MAX_AGE_SECONDS,
  };
}

// Reading uses next/headers — fine in Server Components and route handlers,
// which is everywhere this is needed (resolving attribution when an order
// is placed, in Phase 6). Setting the cookie happens on the redirect
// response directly in src/app/api/attribution/click/route.ts instead of
// here, since that route builds its own NextResponse and setting cookies
// via next/headers vs. response.cookies are two different mechanisms best
// not mixed on the same response.
export async function getAttributionCookieId(): Promise<string | null> {
  const store = await cookies();
  const raw = store.get(ATTRIBUTION_COOKIE_NAME)?.value;
  if (!raw) return null;
  return verifyAttributionCookie(raw);
}
