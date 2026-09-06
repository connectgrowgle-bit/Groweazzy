import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { mfaRecoveryCodes, rateLimitBuckets, users } from '@/db/schema';
import { generateTotpCode } from '@/lib/auth/totp';
import { createTestUser, deleteTestUser } from './helpers';
import { TEST_SERVER_URL } from './global-setup';

const BASE_URL = TEST_SERVER_URL;
const createdUserIds: string[] = [];

function extractCookieHeader(res: Response): string {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (!id) continue;
    // mfa:enable:<userId> and mfa:disable:<userId> are the two
    // deterministically-keyed rate-limit buckets these tests can create
    // (src/app/api/auth/mfa/enable and .../disable, both keyed by user
    // id) — cleaned up alongside the user itself. mfa:session:<sessionId>
    // (src/app/api/auth/mfa/verify) is keyed by an id this file never
    // captures directly and is left for src/lib/rate-limit.ts's own
    // opportunistic sweep (Phase 11) to reclaim, same as any other
    // short-lived rate-limit row this suite doesn't hand-track.
    await db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, `mfa:enable:${id}`));
    await db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, `mfa:disable:${id}`));
    await deleteTestUser(id);
  }
});

// enrollUser() below already burns one time step (the code it submits to
// /api/auth/mfa/enable is inserted into mfa_used_codes and can never be
// accepted again). A test that then needs its OWN fresh, still-unused code
// against the same secret — moments later, easily inside the same 30s
// window a plain generateTotpCode(secret) would reuse — asks for one a
// step ahead instead: still within verifyTotpCode's ±1-step drift
// tolerance of the real "now" it's checked against, but a different
// time step than whatever enrollment already consumed.
function freshCodeAfterEnrollment(secret: string): string {
  return generateTotpCode(secret, new Date(Date.now() + 30_000));
}

async function loginAndGetCookie(email: string, password: string) {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { res, cookie: extractCookieHeader(res) };
}

describe('MFA enrollment (real server, real Postgres)', () => {
  it('rejects setup/enable/disable with no session at all', async () => {
    const setupRes = await fetch(`${BASE_URL}/api/auth/mfa/setup`, { method: 'POST' });
    expect(setupRes.status).toBe(401);

    const enableRes = await fetch(`${BASE_URL}/api/auth/mfa/enable`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    });
    expect(enableRes.status).toBe(401);
  });

  it('full enrollment: setup -> enable with a real generated code -> recovery codes issued, mfaEnabled flips to true', async () => {
    const { user, email, password } = await createTestUser();
    createdUserIds.push(user.id);
    const { cookie } = await loginAndGetCookie(email, password);
    expect(cookie).toContain('ge_session=');

    const setupRes = await fetch(`${BASE_URL}/api/auth/mfa/setup`, { method: 'POST', headers: { cookie } });
    expect(setupRes.status).toBe(200);
    const { secret, otpauthUrl } = await setupRes.json();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUrl).toContain(encodeURIComponent(email));

    // Not enabled yet — a pending, unconfirmed secret alone must not flip it.
    const [pending] = await db.select().from(users).where(eq(users.id, user.id));
    expect(pending?.mfaEnabled).toBe(false);

    const code = generateTotpCode(secret);
    const enableRes = await fetch(`${BASE_URL}/api/auth/mfa/enable`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(enableRes.status).toBe(200);
    const { recoveryCodes } = await enableRes.json();
    expect(recoveryCodes).toHaveLength(10);
    for (const rc of recoveryCodes) expect(rc).toMatch(/^\d{4}-\d{4}$/);

    const [enabled] = await db.select().from(users).where(eq(users.id, user.id));
    expect(enabled?.mfaEnabled).toBe(true);

    // The session that just enrolled is immediately usable — it isn't
    // logged out by its own act of turning MFA on.
    const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, { headers: { cookie } });
    expect(sessionRes.status).toBe(200);
  });

  it('rejects an invalid code at the enable step and leaves mfaEnabled false', async () => {
    const { user, email, password } = await createTestUser();
    createdUserIds.push(user.id);
    const { cookie } = await loginAndGetCookie(email, password);
    await fetch(`${BASE_URL}/api/auth/mfa/setup`, { method: 'POST', headers: { cookie } });

    const enableRes = await fetch(`${BASE_URL}/api/auth/mfa/enable`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code: '000000' }),
    });
    expect(enableRes.status).toBe(400);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.mfaEnabled).toBe(false);
  });
});

describe('MFA login challenge (real server, real Postgres)', () => {
  async function enrollUser() {
    const { user, email, password } = await createTestUser();
    createdUserIds.push(user.id);
    const { cookie: enrollCookie } = await loginAndGetCookie(email, password);
    const setupRes = await fetch(`${BASE_URL}/api/auth/mfa/setup`, { method: 'POST', headers: { cookie: enrollCookie } });
    const { secret } = await setupRes.json();
    const enableRes = await fetch(`${BASE_URL}/api/auth/mfa/enable`, {
      method: 'POST',
      headers: { cookie: enrollCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code: generateTotpCode(secret) }),
    });
    const { recoveryCodes } = await enableRes.json();
    return { user, email, password, secret, recoveryCodes: recoveryCodes as string[] };
  }

  it('login on an MFA-enabled account returns mfaRequired and the session is not usable until verified', async () => {
    const { email, password, secret } = await enrollUser();

    const { res: loginRes, cookie } = await loginAndGetCookie(email, password);
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.mfaRequired).toBe(true);
    expect(cookie).toContain('ge_session=');

    const blockedSessionRes = await fetch(`${BASE_URL}/api/auth/session`, { headers: { cookie } });
    expect(blockedSessionRes.status).toBe(401);

    const verifyRes = await fetch(`${BASE_URL}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code: freshCodeAfterEnrollment(secret) }),
    });
    expect(verifyRes.status).toBe(200);

    const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, { headers: { cookie } });
    expect(sessionRes.status).toBe(200);
  });

  it('rejects a wrong code at the verify step', async () => {
    const { email, password } = await enrollUser();
    const { cookie } = await loginAndGetCookie(email, password);

    const verifyRes = await fetch(`${BASE_URL}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code: '000000' }),
    });
    expect(verifyRes.status).toBe(400);
  });

  it('the same TOTP code cannot be replayed twice, even though it is still cryptographically valid', async () => {
    const { email, password, secret } = await enrollUser();
    const { cookie } = await loginAndGetCookie(email, password);
    const code = freshCodeAfterEnrollment(secret);

    const first = await fetch(`${BASE_URL}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(first.status).toBe(200);

    // A second login creates a second, distinct, unverified session — the
    // replay guard is keyed on (userId, timeStep), not per-session, so the
    // SAME code must still be rejected here even though it's a different
    // session token.
    const { cookie: secondCookie } = await loginAndGetCookie(email, password);
    const second = await fetch(`${BASE_URL}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { cookie: secondCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(second.status).toBe(400);
  });

  it('a recovery code works once, then is rejected on reuse', async () => {
    const { email, password, recoveryCodes } = await enrollUser();
    const usedCode = recoveryCodes[0]!;

    const { cookie } = await loginAndGetCookie(email, password);
    const first = await fetch(`${BASE_URL}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code: usedCode }),
    });
    expect(first.status).toBe(200);

    const { cookie: secondCookie } = await loginAndGetCookie(email, password);
    const second = await fetch(`${BASE_URL}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { cookie: secondCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code: usedCode }),
    });
    expect(second.status).toBe(400);
  });

  it('rate-limits repeated wrong codes at the verify step, keyed per session', async () => {
    const { email, password } = await enrollUser();
    const { cookie } = await loginAndGetCookie(email, password);

    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${BASE_URL}/api/auth/mfa/verify`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ code: '000000' }),
      });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(400);

    const blockedRes = await fetch(`${BASE_URL}/api/auth/mfa/verify`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code: '000000' }),
    });
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get('retry-after')).toBeTruthy();
  });
});

describe('MFA disable (real server, real Postgres)', () => {
  it('requires both the correct password and a valid code, then clears MFA and its recovery codes', async () => {
    const { user, email, password } = await createTestUser();
    createdUserIds.push(user.id);
    const { cookie: enrollCookie } = await loginAndGetCookie(email, password);
    const setupRes = await fetch(`${BASE_URL}/api/auth/mfa/setup`, { method: 'POST', headers: { cookie: enrollCookie } });
    const { secret } = await setupRes.json();
    await fetch(`${BASE_URL}/api/auth/mfa/enable`, {
      method: 'POST',
      headers: { cookie: enrollCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ code: generateTotpCode(secret) }),
    });

    const wrongPasswordRes = await fetch(`${BASE_URL}/api/auth/mfa/disable`, {
      method: 'POST',
      headers: { cookie: enrollCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'not-the-real-password', code: generateTotpCode(secret) }),
    });
    expect(wrongPasswordRes.status).toBe(400);

    const disableRes = await fetch(`${BASE_URL}/api/auth/mfa/disable`, {
      method: 'POST',
      headers: { cookie: enrollCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ password, code: generateTotpCode(secret) }),
    });
    expect(disableRes.status).toBe(200);

    const [row] = await db.select().from(users).where(eq(users.id, user.id));
    expect(row?.mfaEnabled).toBe(false);
    expect(row?.mfaSecretEncrypted).toBeNull();

    const remainingCodes = await db.select().from(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, user.id));
    expect(remainingCodes).toHaveLength(0);
  });
});
