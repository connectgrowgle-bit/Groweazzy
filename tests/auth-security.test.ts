import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { rateLimitBuckets, users } from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';
import * as argon2 from 'argon2';
import { TEST_SERVER_URL } from './global-setup';
import { deleteTestUser } from './helpers';

const BASE_URL = TEST_SERVER_URL;
const createdUserIds: string[] = [];
const createdRateLimitKeys: string[] = [];

afterAll(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
  while (createdRateLimitKeys.length) {
    const key = createdRateLimitKeys.pop();
    if (key) await db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, key));
  }
});

describe('login rate limiting (real server, real Postgres)', () => {
  it('blocks after 10 attempts against the same email within the window, with a Retry-After header', async () => {
    const email = `ratelimit-${randomUUID()}@example.test`;
    createdRateLimitKeys.push(`login:email:${email}`);

    let lastStatus = 0;
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong-password-attempt' }),
      });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(401); // still just "invalid credentials" through attempt 10

    const blockedRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong-password-attempt' }),
    });
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get('retry-after')).toBeTruthy();
  });
});

// The shared test server deliberately runs with NO TRUSTED_PROXY_HEADER
// configured (tests/test-env-constants.ts's own comment explains why: this
// sandbox's loopback connections already arrive with a real-looking
// `x-forwarded-for` stamped on them by something upstream of Node, and
// trusting that header on the shared test server would collapse every
// HTTP-level test's requests onto one IP-keyed bucket). That happens to
// also be exactly the "no reverse proxy configured yet" case a real
// deployment starts in — so these tests assert the actual security
// property that matters here: an operator who HASN'T set
// TRUSTED_PROXY_HEADER yet is not exposed to a client trivially forging a
// distinct-looking source IP per request to dodge (or attack) IP-based
// limiting, because the header is never read at all in that state.
describe('register/contact IP-based limiting when no trusted proxy is configured (real server, real Postgres)', () => {
  it('an unconfigured x-forwarded-for on /api/auth/register has no effect — no bucket row is created', async () => {
    const spoofedIp = '203.0.113.99';
    for (let i = 0; i < 3; i++) {
      const email = `untrusted-ip-reg-${randomUUID()}@example.test`;
      const res = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': spoofedIp },
        body: JSON.stringify({ fullName: 'Untrusted IP Test', email, password: 'a-strong-enough-password' }),
      });
      expect(res.status).toBe(201);
      const [userRow] = await db.select().from(users).where(eq(users.email, email));
      if (userRow) createdUserIds.push(userRow.id);
    }

    const rows = await db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.key, `register:ip:${spoofedIp}`));
    expect(rows).toHaveLength(0);
  });

  it('an unconfigured x-forwarded-for on /api/contact has no effect — no bucket row is created', async () => {
    const spoofedIp = '203.0.113.100';
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${BASE_URL}/api/contact`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': spoofedIp },
        body: JSON.stringify({ name: 'Test', email: 'test@example.test', message: 'Hello, this is a test message.' }),
      });
      expect(res.status).toBe(200);
    }

    const rows = await db.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.key, `contact:ip:${spoofedIp}`));
    expect(rows).toHaveLength(0);
  });
});

describe('opportunistic Argon2 rehash on login (real server, real Postgres)', () => {
  it('re-hashes a password created under weaker parameters after a successful login', async () => {
    const email = `rehash-${randomUUID()}@example.test`;
    const password = 'a-strong-enough-password';
    // Deliberately weaker than src/lib/auth/password.ts's ARGON2_OPTIONS —
    // simulates an account whose hash predates a parameter bump.
    const weakHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 8192,
      timeCost: 1,
      parallelism: 1,
    });
    const [user] = await db.insert(users).values({ email, passwordHash: weakHash }).returning();
    if (!user) throw new Error('failed to create test user');
    createdUserIds.push(user.id);
    createdRateLimitKeys.push(`login:email:${email}`);

    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(loginRes.status).toBe(200);

    const [updated] = await db.select().from(users).where(eq(users.id, user.id));
    expect(updated?.passwordHash).not.toBe(weakHash);
    // The new hash still verifies the same real password.
    expect(await argon2.verify(updated!.passwordHash, password)).toBe(true);
  });

  it('does not touch an already-current hash', async () => {
    const email = `no-rehash-${randomUUID()}@example.test`;
    const password = 'a-strong-enough-password';
    const currentHash = await hashPassword(password);
    const [user] = await db.insert(users).values({ email, passwordHash: currentHash }).returning();
    if (!user) throw new Error('failed to create test user');
    createdUserIds.push(user.id);
    createdRateLimitKeys.push(`login:email:${email}`);

    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(loginRes.status).toBe(200);

    const [updated] = await db.select().from(users).where(eq(users.id, user.id));
    expect(updated?.passwordHash).toBe(currentHash);
  });
});
