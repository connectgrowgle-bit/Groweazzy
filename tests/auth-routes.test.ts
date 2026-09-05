import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';
import { TEST_SERVER_URL } from './global-setup';

// Hits the single shared server started once in tests/global-setup.ts,
// over real HTTP, rather than calling route handler functions directly —
// required because src/lib/auth/cookies.ts uses next/headers, which only
// works inside Next's own request pipeline. This is also what the project
// brief's testing philosophy asks for: "every suite runs against a real
// PostgreSQL and a real running server."
const BASE_URL = TEST_SERVER_URL;

const createdUserIds: string[] = [];

function extractCookieHeader(res: Response): string {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

afterAll(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await db.delete(users).where(eq(users.id, id));
  }
});

describe('auth API routes (real server, real Postgres)', () => {
  it('registers a user, sets a session cookie, and the session works against /api/auth/session', async () => {
    const email = `route-test-${randomUUID()}@example.test`;
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Route Test', email, password: 'a-strong-enough-password' }),
    });
    expect(res.status).toBe(201);
    const cookie = extractCookieHeader(res);
    expect(cookie).toContain('ge_session=');

    // Read the database back — a 201 with no real row would look identical
    // from outside.
    const [userRow] = await db.select().from(users).where(eq(users.email, email));
    expect(userRow).toBeDefined();
    if (userRow) createdUserIds.push(userRow.id);

    const [sessionRow] = await db.select().from(sessions).where(eq(sessions.userId, userRow!.id));
    expect(sessionRow).toBeDefined();
    expect(sessionRow?.revokedAt).toBeNull();

    const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, { headers: { cookie } });
    expect(sessionRes.status).toBe(200);
    const body = await sessionRes.json();
    expect(body.user.email).toBe(email);
  });

  it('rejects a duplicate email on registration with 409', async () => {
    const email = `route-test-${randomUUID()}@example.test`;
    const payload = { fullName: 'Dup Test', email, password: 'a-strong-enough-password' };

    const first = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(201);
    const [userRow] = await db.select().from(users).where(eq(users.email, email));
    if (userRow) createdUserIds.push(userRow.id);

    const second = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(409);
  });

  it('logs in with correct credentials and the resulting session is valid', async () => {
    const email = `route-test-${randomUUID()}@example.test`;
    const password = 'a-strong-enough-password';
    const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Login Test', email, password }),
    });
    const [userRow] = await db.select().from(users).where(eq(users.email, email));
    if (userRow) createdUserIds.push(userRow.id);
    expect(registerRes.status).toBe(201);

    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(loginRes.status).toBe(200);
    const cookie = extractCookieHeader(loginRes);

    const sessionRes = await fetch(`${BASE_URL}/api/auth/session`, { headers: { cookie } });
    expect(sessionRes.status).toBe(200);
  });

  // The core enumeration-safety property: rule 14 in docs/ARCHITECTURE.md.
  // An unknown email and a wrong password on a real account must be
  // indistinguishable from outside — same status code, same response body
  // shape, and (via the dummy-hash comparison) comparable wall-clock time.
  it('returns identical status and body for an unknown email vs. a wrong password on a real account', async () => {
    const email = `route-test-${randomUUID()}@example.test`;
    const password = 'a-strong-enough-password';
    const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Enum Test', email, password }),
    });
    const [userRow] = await db.select().from(users).where(eq(users.email, email));
    if (userRow) createdUserIds.push(userRow.id);
    expect(registerRes.status).toBe(201);

    const wrongPasswordRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'definitely-the-wrong-password' }),
    });
    const unknownEmailRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `no-such-user-${randomUUID()}@example.test`, password }),
    });

    expect(wrongPasswordRes.status).toBe(unknownEmailRes.status);
    expect(wrongPasswordRes.status).toBe(401);

    const [wrongBody, unknownBody] = await Promise.all([wrongPasswordRes.json(), unknownEmailRes.json()]);
    expect(wrongBody).toEqual(unknownBody);
  });

  it('logout revokes the session — it no longer works even with the cookie replayed', async () => {
    const email = `route-test-${randomUUID()}@example.test`;
    const password = 'a-strong-enough-password';
    const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Logout Test', email, password }),
    });
    const [userRow] = await db.select().from(users).where(eq(users.email, email));
    if (userRow) createdUserIds.push(userRow.id);
    const cookie = extractCookieHeader(registerRes);

    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    expect(logoutRes.status).toBe(200);

    const replayedRes = await fetch(`${BASE_URL}/api/auth/session`, { headers: { cookie } });
    expect(replayedRes.status).toBe(401);

    const [sessionRow] = await db.select().from(sessions).where(eq(sessions.userId, userRow!.id));
    expect(sessionRow?.revokedAt).not.toBeNull();
  });

  it('suspending a user server-side invalidates their existing session on its very next use', async () => {
    const email = `route-test-${randomUUID()}@example.test`;
    const password = 'a-strong-enough-password';
    const registerRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Suspend Test', email, password }),
    });
    const [userRow] = await db.select().from(users).where(eq(users.email, email));
    if (userRow) createdUserIds.push(userRow.id);
    const cookie = extractCookieHeader(registerRes);

    // Confirm the session works before suspension.
    expect((await fetch(`${BASE_URL}/api/auth/session`, { headers: { cookie } })).status).toBe(200);

    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, userRow!.id));

    const afterSuspend = await fetch(`${BASE_URL}/api/auth/session`, { headers: { cookie } });
    expect(afterSuspend.status).toBe(401);
  });
});
