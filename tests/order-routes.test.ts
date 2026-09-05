import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { crmContacts, roles, userRoles, users } from '@/db/schema';
import { seedRolesAndPermissions } from '@/lib/auth/seed-rbac';
import { seedCatalogueFromRepository } from '@/lib/catalogue';
import { TEST_SERVER_URL } from './global-setup';
import { deleteTestUser } from './helpers';

const BASE_URL = TEST_SERVER_URL;
const PLAN_ID = 'aca-standard'; // AI Content Avatar — src/lib/repository.ts

// A complete, valid submit payload for the ai-content-avatar onboarding
// schema (src/lib/onboarding-schemas.ts) — every field required by its
// submit schema present.
const COMPLETE_AI_CONTENT_BRIEF = {
  brandName: 'Test Brand',
  positioningSummary: 'A test brand for order-routes.test.ts',
  voiceReferenceUrl: 'https://example.test/voice-sample',
  postingCadencePerWeek: 3,
  platforms: ['instagram', 'linkedin'],
};

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

// Drives checkout all the way to a confirmed, PAID (→ auto-advanced to
// ONBOARDING) order — the starting point most of these tests build on.
async function checkoutAndConfirm(cookie: string): Promise<string> {
  const checkoutRes = await fetch(`${BASE_URL}/api/orders/checkout`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ planId: PLAN_ID }),
  });
  expect(checkoutRes.status).toBe(201);
  const { orderId, gatewayOrderId } = await checkoutRes.json();

  const captureRes = await fetch(`${BASE_URL}/api/dev/mock-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gatewayOrderId, outcome: 'captured' }),
  });
  const { gatewayPaymentId } = await captureRes.json();

  const confirmRes = await fetch(`${BASE_URL}/api/orders/${orderId}/confirm`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ gatewayPaymentId }),
  });
  expect(confirmRes.status).toBe(200);
  const confirmed = await confirmRes.json();
  expect(confirmed.stage).toBe('ONBOARDING');

  return orderId;
}

beforeAll(async () => {
  await seedRolesAndPermissions();
  await seedCatalogueFromRepository();
});

afterAll(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('order workflow API routes (real server, real Postgres)', () => {
  it('full lifecycle over HTTP: checkout -> confirm -> CRM contact -> onboarding -> meeting -> lock', async () => {
    const client = await registerAndGetCookie('orderclient');
    const staff = await registerAndGetCookie('orderstaff');
    await grantRole(staff.userId, 'STAFF');

    const orderId = await checkoutAndConfirm(client.cookie);

    // "order -> CRM contact" (docs/ARCHITECTURE.md §8) happened as a side
    // effect of confirm, not a separate call.
    const [contact] = await db.select().from(crmContacts).where(eq(crmContacts.email, client.email));
    expect(contact).toBeDefined();
    expect(contact?.stage).toBe('ONBOARDING');

    // Save a partial draft — draft schema is all-optional.
    const draftRes = await fetch(`${BASE_URL}/api/orders/${orderId}/onboarding`, {
      method: 'PUT',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ brandName: 'Draft Brand Name' }),
    });
    expect(draftRes.status).toBe(200);
    expect((await draftRes.json()).isDraft).toBe(true);

    // Submitting the full brief does NOT lock requirements or change stage.
    const submitRes = await fetch(`${BASE_URL}/api/orders/${orderId}/onboarding`, {
      method: 'POST',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify(COMPLETE_AI_CONTENT_BRIEF),
    });
    expect(submitRes.status).toBe(200);
    expect((await submitRes.json()).isDraft).toBe(false);

    const afterSubmit = await (
      await fetch(`${BASE_URL}/api/orders/${orderId}`, { headers: { cookie: client.cookie } })
    ).json();
    expect(afterSubmit.order.stage).toBe('ONBOARDING');
    expect(afterSubmit.order.requirementsLockedAt).toBeNull();

    // A plain client cannot schedule a meeting.
    const forbiddenMeeting = await fetch(`${BASE_URL}/api/orders/${orderId}/meeting`, {
      method: 'POST',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ scheduledAt: new Date(Date.now() + 86400000).toISOString() }),
    });
    expect(forbiddenMeeting.status).toBe(403);

    // Staff schedules a meeting -> order advances to MEETING_SCHEDULED.
    const meetingRes = await fetch(`${BASE_URL}/api/orders/${orderId}/meeting`, {
      method: 'POST',
      headers: { cookie: staff.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ scheduledAt: new Date(Date.now() + 86400000).toISOString() }),
    });
    expect(meetingRes.status).toBe(201);

    const afterMeeting = await (
      await fetch(`${BASE_URL}/api/orders/${orderId}`, { headers: { cookie: client.cookie } })
    ).json();
    expect(afterMeeting.order.stage).toBe('MEETING_SCHEDULED');
    expect(afterMeeting.meetings).toHaveLength(1);

    // Locking is staff-only and one-way.
    const forbiddenLock = await fetch(`${BASE_URL}/api/orders/${orderId}/lock-requirements`, {
      method: 'POST',
      headers: { cookie: client.cookie },
    });
    expect(forbiddenLock.status).toBe(403);

    const lockRes = await fetch(`${BASE_URL}/api/orders/${orderId}/lock-requirements`, {
      method: 'POST',
      headers: { cookie: staff.cookie },
    });
    expect(lockRes.status).toBe(200);
    const locked = await lockRes.json();
    expect(locked.stage).toBe('REQUIREMENTS_LOCKED');
    expect(locked.requirementsLockedAt).not.toBeNull();

    // No editing the brief after locking.
    const editAfterLock = await fetch(`${BASE_URL}/api/orders/${orderId}/onboarding`, {
      method: 'PUT',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ brandName: 'Should not save' }),
    });
    expect(editAfterLock.status).toBe(409);
  });

  it('submitting an incomplete brief is rejected by the submit schema (draft schema would accept it)', async () => {
    const client = await registerAndGetCookie('incompletebrief');
    const orderId = await checkoutAndConfirm(client.cookie);

    const draftRes = await fetch(`${BASE_URL}/api/orders/${orderId}/onboarding`, {
      method: 'PUT',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ brandName: 'Only One Field' }),
    });
    expect(draftRes.status).toBe(200);

    const submitRes = await fetch(`${BASE_URL}/api/orders/${orderId}/onboarding`, {
      method: 'POST',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ brandName: 'Only One Field' }),
    });
    expect(submitRes.status).toBe(400);
  });

  it('locking requirements before a meeting is scheduled is refused (order is not at MEETING_SCHEDULED)', async () => {
    const client = await registerAndGetCookie('lockearly');
    const staff = await registerAndGetCookie('lockearlystaff');
    await grantRole(staff.userId, 'STAFF');
    const orderId = await checkoutAndConfirm(client.cookie);

    await fetch(`${BASE_URL}/api/orders/${orderId}/onboarding`, {
      method: 'POST',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify(COMPLETE_AI_CONTENT_BRIEF),
    });

    const lockRes = await fetch(`${BASE_URL}/api/orders/${orderId}/lock-requirements`, {
      method: 'POST',
      headers: { cookie: staff.cookie },
    });
    expect(lockRes.status).toBe(409);
  });

  it('locking requirements is refused when onboarding was only ever saved as a draft', async () => {
    const client = await registerAndGetCookie('draftonly');
    const staff = await registerAndGetCookie('draftonlystaff');
    await grantRole(staff.userId, 'STAFF');
    const orderId = await checkoutAndConfirm(client.cookie);

    await fetch(`${BASE_URL}/api/orders/${orderId}/onboarding`, {
      method: 'PUT',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ brandName: 'Still a draft' }),
    });
    await fetch(`${BASE_URL}/api/orders/${orderId}/meeting`, {
      method: 'POST',
      headers: { cookie: staff.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ scheduledAt: new Date(Date.now() + 86400000).toISOString() }),
    });

    const lockRes = await fetch(`${BASE_URL}/api/orders/${orderId}/lock-requirements`, {
      method: 'POST',
      headers: { cookie: staff.cookie },
    });
    expect(lockRes.status).toBe(409);
  });

  it("viewing or editing another client's order returns 404, not 403", async () => {
    const owner = await registerAndGetCookie('orderowner');
    const attacker = await registerAndGetCookie('orderattacker');
    const orderId = await checkoutAndConfirm(owner.cookie);

    const getRes = await fetch(`${BASE_URL}/api/orders/${orderId}`, { headers: { cookie: attacker.cookie } });
    expect(getRes.status).toBe(404);

    const putRes = await fetch(`${BASE_URL}/api/orders/${orderId}/onboarding`, {
      method: 'PUT',
      headers: { cookie: attacker.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ brandName: 'Attacker Brand' }),
    });
    expect(putRes.status).toBe(404);
  });

  it('checkout for an unknown plan id returns 404', async () => {
    const client = await registerAndGetCookie('unknownplan');
    const res = await fetch(`${BASE_URL}/api/orders/checkout`, {
      method: 'POST',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ planId: 'no-such-plan' }),
    });
    expect(res.status).toBe(404);
  });

  it('a client can cancel their own order before payment, and it is not payable afterward', async () => {
    const client = await registerAndGetCookie('cancelbeforepay');
    const checkoutRes = await fetch(`${BASE_URL}/api/orders/checkout`, {
      method: 'POST',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ planId: PLAN_ID }),
    });
    const { orderId, gatewayOrderId } = await checkoutRes.json();

    const cancelRes = await fetch(`${BASE_URL}/api/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: { cookie: client.cookie },
    });
    expect(cancelRes.status).toBe(200);
    expect((await cancelRes.json()).stage).toBe('CANCELLED');

    // A cancelled order cannot be cancelled again (no CANCELLED -> CANCELLED edge).
    const secondCancel = await fetch(`${BASE_URL}/api/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: { cookie: client.cookie },
    });
    expect(secondCancel.status).toBe(409);

    // Confirming a cancelled order's payment is still mechanically possible
    // (the payment row itself has no stage), but the order's own stage
    // must not silently revert — AWAITING_PAYMENT -> PAID is the only
    // transition handleServiceOrderPaymentCaptured performs, and this order
    // is no longer AWAITING_PAYMENT.
    const captureRes = await fetch(`${BASE_URL}/api/dev/mock-payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gatewayOrderId, outcome: 'captured' }),
    });
    const { gatewayPaymentId } = await captureRes.json();
    await fetch(`${BASE_URL}/api/orders/${orderId}/confirm`, {
      method: 'POST',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ gatewayPaymentId }),
    });

    const afterAttempt = await (
      await fetch(`${BASE_URL}/api/orders/${orderId}`, { headers: { cookie: client.cookie } })
    ).json();
    expect(afterAttempt.order.stage).toBe('CANCELLED');
  });
});
