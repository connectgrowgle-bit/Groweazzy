import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';

// These specifically hit a real running Next.js server over HTTP rather than
// calling the route handler functions directly, because src/lib/auth/cookies.ts
// uses next/headers' cookies() — which only works inside Next's own request
// pipeline, not when a route handler is invoked as a plain function outside
// it. This is also what the project brief's testing philosophy asks for:
// "every suite runs against a real PostgreSQL and a real running server."
const PORT = 3901;
const BASE_URL = `http://localhost:${PORT}`;

let server: ChildProcess;
const createdUserIds: string[] = [];

function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) return reject(new Error(`Server at ${url} did not become ready in time`));
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

function extractCookieHeader(res: Response): string {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

beforeAll(async () => {
  server = spawn('npx', ['next', 'dev', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      APP_ENV: 'development',
      APP_URL: BASE_URL,
      DATABASE_SSL: 'false',
      SESSION_SECRET: 'test-only-session-secret-at-least-32-characters',
      PII_ENCRYPTION_KEY: '0'.repeat(64),
      PAYMENT_PROVIDER: 'mock',
      PAYMENT_MODE: 'test',
      CRON_SECRET: 'test-only-cron-secret',
      EMAIL_PROVIDER: 'console',
      STORAGE_DRIVER: 'local',
    },
    stdio: 'pipe',
  });

  let stderr = '';
  server.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForServer(`${BASE_URL}/api/health`, 60000);
  } catch (err) {
    throw new Error(`${(err as Error).message}\nServer stderr:\n${stderr}`);
  }
}, 70000);

afterAll(async () => {
  server?.kill('SIGTERM');
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
