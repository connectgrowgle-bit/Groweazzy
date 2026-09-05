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
const PLAN_ID = 'aca-standard';

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

async function checkoutAndConfirm(cookie: string): Promise<string> {
  const checkoutRes = await fetch(`${BASE_URL}/api/orders/checkout`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ planId: PLAN_ID }),
  });
  const { orderId, gatewayOrderId } = await checkoutRes.json();

  const captureRes = await fetch(`${BASE_URL}/api/dev/mock-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gatewayOrderId, outcome: 'captured' }),
  });
  const { gatewayPaymentId } = await captureRes.json();

  await fetch(`${BASE_URL}/api/orders/${orderId}/confirm`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ gatewayPaymentId }),
  });

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

describe('CRM API routes (real server, real Postgres)', () => {
  it('a plain client cannot list or view CRM contacts', async () => {
    const client = await registerAndGetCookie('crmplainclient');

    const listRes = await fetch(`${BASE_URL}/api/crm/contacts`, { headers: { cookie: client.cookie } });
    expect(listRes.status).toBe(403);
  });

  it('full staff flow: view a checkout-created contact, edit stage, assign, add note, manage a task', async () => {
    const client = await registerAndGetCookie('crmclient');
    const staff = await registerAndGetCookie('crmstaff');
    await grantRole(staff.userId, 'STAFF');

    const orderId = await checkoutAndConfirm(client.cookie);

    const [contactRow] = await db.select().from(crmContacts).where(eq(crmContacts.email, client.email));
    expect(contactRow).toBeDefined();
    const contactId = contactRow!.id;

    const listRes = await fetch(`${BASE_URL}/api/crm/contacts`, { headers: { cookie: staff.cookie } });
    expect(listRes.status).toBe(200);
    const { contacts } = await listRes.json();
    expect(contacts.some((c: { id: string }) => c.id === contactId)).toBe(true);

    const detailRes = await fetch(`${BASE_URL}/api/crm/contacts/${contactId}`, { headers: { cookie: staff.cookie } });
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.contact.email).toBe(client.email);
    expect(detail.orders).toHaveLength(1);
    expect(detail.orders[0].id).toBe(orderId);

    const patchRes = await fetch(`${BASE_URL}/api/crm/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { cookie: staff.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Renamed Contact' }),
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).fullName).toBe('Renamed Contact');

    const assignRes = await fetch(`${BASE_URL}/api/crm/contacts/${contactId}/assign`, {
      method: 'POST',
      headers: { cookie: staff.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ownerUserId: staff.userId }),
    });
    expect(assignRes.status).toBe(200);
    expect((await assignRes.json()).ownerUserId).toBe(staff.userId);

    const noteRes = await fetch(`${BASE_URL}/api/crm/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: { cookie: staff.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Reached out via WhatsApp' }),
    });
    expect(noteRes.status).toBe(201);

    const taskRes = await fetch(`${BASE_URL}/api/crm/tasks`, {
      method: 'POST',
      headers: { cookie: staff.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ contactId, title: 'Send onboarding reminder' }),
    });
    expect(taskRes.status).toBe(201);
    const task = await taskRes.json();

    const taskPatchRes = await fetch(`${BASE_URL}/api/crm/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { cookie: staff.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'DONE' }),
    });
    expect(taskPatchRes.status).toBe(200);
    expect((await taskPatchRes.json()).status).toBe('DONE');

    const finalDetail = await (
      await fetch(`${BASE_URL}/api/crm/contacts/${contactId}`, { headers: { cookie: staff.cookie } })
    ).json();
    expect(finalDetail.notes).toHaveLength(1);
    expect(finalDetail.tasks).toHaveLength(1);
    expect(finalDetail.tasks[0].status).toBe('DONE');
  });
});

describe('Generic order-advance API route (real server, real Postgres)', () => {
  it('staff can drive an order from TEAM_ASSIGNED through COMPLETED, and the CRM contact follows it', async () => {
    const client = await registerAndGetCookie('advanceclient');
    const staff = await registerAndGetCookie('advancestaff');
    await grantRole(staff.userId, 'STAFF');
    const orderId = await checkoutAndConfirm(client.cookie); // -> ONBOARDING

    // Drive it the rest of the way through the chain using the specific
    // endpoints where they exist, and the generic one where they don't.
    await fetch(`${BASE_URL}/api/orders/${orderId}/onboarding`, {
      method: 'POST',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        brandName: 'Advance Test Brand',
        positioningSummary: 'Testing the advance route',
        voiceReferenceUrl: 'https://example.test/voice',
        postingCadencePerWeek: 2,
        platforms: ['instagram'],
      }),
    });
    await fetch(`${BASE_URL}/api/orders/${orderId}/meeting`, {
      method: 'POST',
      headers: { cookie: staff.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ scheduledAt: new Date(Date.now() + 86400000).toISOString() }),
    });
    await fetch(`${BASE_URL}/api/orders/${orderId}/lock-requirements`, {
      method: 'POST',
      headers: { cookie: staff.cookie },
    });

    for (const toStage of ['TEAM_ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'DELIVERED', 'COMPLETED']) {
      const res = await fetch(`${BASE_URL}/api/orders/${orderId}/advance`, {
        method: 'POST',
        headers: { cookie: staff.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ toStage }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).stage).toBe(toStage);
    }

    const [contactRow] = await db.select().from(crmContacts).where(eq(crmContacts.email, client.email));
    expect(contactRow?.stage).toBe('COMPLETED');
  });

  it('a plain client cannot advance an order, and an illegal transition is refused', async () => {
    const client = await registerAndGetCookie('advanceforbidden');
    const staff = await registerAndGetCookie('advanceforbiddenstaff');
    await grantRole(staff.userId, 'STAFF');
    const orderId = await checkoutAndConfirm(client.cookie); // -> ONBOARDING

    const forbidden = await fetch(`${BASE_URL}/api/orders/${orderId}/advance`, {
      method: 'POST',
      headers: { cookie: client.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ toStage: 'COMPLETED' }),
    });
    expect(forbidden.status).toBe(403);

    const illegal = await fetch(`${BASE_URL}/api/orders/${orderId}/advance`, {
      method: 'POST',
      headers: { cookie: staff.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ toStage: 'COMPLETED' }), // ONBOARDING -> COMPLETED is not a legal edge
    });
    expect(illegal.status).toBe(409);
  });
});
