import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliates, roles, userRoles, users } from '@/db/schema';
import { seedRolesAndPermissions } from '@/lib/auth/seed-rbac';
import { TEST_SERVER_URL } from './global-setup';
import { deleteTestUser } from './helpers';

// Hits the single shared server started once in tests/global-setup.ts — see
// that file's comment for why these HTTP-level suites no longer each spawn
// their own `next dev` (docs/ARCHITECTURE.md §20).
const BASE_URL = TEST_SERVER_URL;

const createdUserIds: string[] = [];

function extractCookieHeader(res: Response): string {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  return setCookies.map((c) => c.split(';')[0]).join('; ');
}

async function registerAndGetCookie(label: string): Promise<{ cookie: string; email: string; userId: string }> {
  const email = `${label}-${randomUUID()}@example.test`;
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: label, email, password: 'a-strong-enough-password' }),
  });
  if (res.status !== 201) throw new Error(`Failed to register ${label}: ${res.status}`);
  const [userRow] = await db.select().from(users).where(eq(users.email, email));
  if (!userRow) throw new Error('User row not found after registration');
  createdUserIds.push(userRow.id);
  return { cookie: extractCookieHeader(res), email, userId: userRow.id };
}

async function grantRole(userId: string, roleKey: string) {
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey));
  if (!role) throw new Error(`Role ${roleKey} not seeded`);
  await db.insert(userRoles).values({ userId, roleId: role.id });
}

beforeAll(async () => {
  await seedRolesAndPermissions();
});

afterAll(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('affiliate API routes (real server, real Postgres)', () => {
  it('full lifecycle over HTTP: register -> KYC -> approve (fee enabled) -> pay -> ACTIVE', async () => {
    const applicant = await registerAndGetCookie('applicant');
    const reviewer = await registerAndGetCookie('reviewer');
    await grantRole(reviewer.userId, 'AFFILIATE_MANAGER');

    const registerRes = await fetch(`${BASE_URL}/api/affiliate/register`, {
      method: 'POST',
      headers: { cookie: applicant.cookie },
    });
    expect(registerRes.status).toBe(201);

    const kycRes = await fetch(`${BASE_URL}/api/affiliate/kyc`, {
      method: 'POST',
      headers: { cookie: applicant.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ pan: 'ABCDE1234F', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' }),
    });
    expect(kycRes.status).toBe(201);
    const kyc = await kycRes.json();

    const reviewRes = await fetch(`${BASE_URL}/api/affiliate/kyc/${kyc.id}/review`, {
      method: 'POST',
      headers: { cookie: reviewer.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVED' }),
    });
    expect(reviewRes.status).toBe(200);

    const meAfterApproval = await (await fetch(`${BASE_URL}/api/affiliate/me`, { headers: { cookie: applicant.cookie } })).json();
    expect(['FEE_PENDING', 'ACTIVE']).toContain(meAfterApproval.status);

    if (meAfterApproval.status === 'FEE_PENDING') {
      const initiateRes = await fetch(`${BASE_URL}/api/affiliate/fee/initiate`, {
        method: 'POST',
        headers: { cookie: applicant.cookie },
      });
      expect(initiateRes.status).toBe(201);
      const { paymentId, gatewayOrderId } = await initiateRes.json();

      const captureRes = await fetch(`${BASE_URL}/api/dev/mock-payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gatewayOrderId, outcome: 'captured' }),
      });
      expect(captureRes.status).toBe(200);
      const { gatewayPaymentId } = await captureRes.json();

      const confirmRes = await fetch(`${BASE_URL}/api/affiliate/fee/confirm`, {
        method: 'POST',
        headers: { cookie: applicant.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ paymentId, gatewayPaymentId }),
      });
      expect(confirmRes.status).toBe(200);
    }

    const finalMe = await (await fetch(`${BASE_URL}/api/affiliate/me`, { headers: { cookie: applicant.cookie } })).json();
    expect(finalMe.status).toBe('ACTIVE');
  });

  it('a user without affiliate.kyc.review cannot review KYC — 403, and the KYC is untouched', async () => {
    const applicant = await registerAndGetCookie('applicant2');
    const plainUser = await registerAndGetCookie('plainuser');

    await fetch(`${BASE_URL}/api/affiliate/register`, { method: 'POST', headers: { cookie: applicant.cookie } });
    const kycRes = await fetch(`${BASE_URL}/api/affiliate/kyc`, {
      method: 'POST',
      headers: { cookie: applicant.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ pan: 'ZYXWV9876G', bankAccountNumber: '999999999999', bankIfsc: 'HDFC0009999' }),
    });
    const kyc = await kycRes.json();

    const reviewRes = await fetch(`${BASE_URL}/api/affiliate/kyc/${kyc.id}/review`, {
      method: 'POST',
      headers: { cookie: plainUser.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVED' }),
    });
    expect(reviewRes.status).toBe(403);

    const meRes = await fetch(`${BASE_URL}/api/affiliate/me`, { headers: { cookie: applicant.cookie } });
    const me = await meRes.json();
    expect(me.status).toBe('KYC_SUBMITTED');
  });

  it('confirming another affiliate\'s payment returns 404, not the payment\'s real state', async () => {
    const owner = await registerAndGetCookie('owner');
    const attacker = await registerAndGetCookie('attacker');

    await fetch(`${BASE_URL}/api/affiliate/register`, { method: 'POST', headers: { cookie: owner.cookie } });
    await fetch(`${BASE_URL}/api/affiliate/register`, { method: 'POST', headers: { cookie: attacker.cookie } });

    // Force owner straight to FEE_PENDING so we can get a real payment id
    // to attack, without needing a reviewer role in this test.
    const [ownerAffiliate] = await db.select().from(affiliates).where(eq(affiliates.userId, owner.userId));
    await db.update(affiliates).set({ status: 'FEE_PENDING' }).where(eq(affiliates.id, ownerAffiliate!.id));

    const initiateRes = await fetch(`${BASE_URL}/api/affiliate/fee/initiate`, {
      method: 'POST',
      headers: { cookie: owner.cookie },
    });
    const { paymentId } = await initiateRes.json();

    const attackRes = await fetch(`${BASE_URL}/api/affiliate/fee/confirm`, {
      method: 'POST',
      headers: { cookie: attacker.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ paymentId, gatewayPaymentId: 'mock_pay_doesnotmatter' }),
    });
    expect(attackRes.status).toBe(404);
  });
});
