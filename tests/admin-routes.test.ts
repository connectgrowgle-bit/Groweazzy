import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { roles, services, userRoles, users } from '@/db/schema';
import { seedRolesAndPermissions } from '@/lib/auth/seed-rbac';
import { TEST_SERVER_URL } from './global-setup';
import { deleteTestUser } from './helpers';

const BASE_URL = TEST_SERVER_URL;
const createdUserIds: string[] = [];
const createdServiceIds: string[] = [];

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
  while (createdServiceIds.length) {
    const id = createdServiceIds.pop();
    if (id) await db.delete(services).where(eq(services.id, id));
  }
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('admin catalogue API routes (real server, real Postgres)', () => {
  it('a plain customer cannot view, edit, or price the catalogue', async () => {
    const plain = await registerAndGetCookie('plaincustomeradmin');

    const listRes = await fetch(`${BASE_URL}/api/admin/services`, { headers: { cookie: plain.cookie } });
    expect(listRes.status).toBe(403);

    const createRes = await fetch(`${BASE_URL}/api/admin/services`, {
      method: 'POST',
      headers: { cookie: plain.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'x', name: 'x', shortDescription: 'x', longDescriptionHtml: '<p/>' }),
    });
    expect(createRes.status).toBe(403);
  });

  it('CONTENT_MANAGER (service.edit) can create/edit copy but cannot touch pricing', async () => {
    const editor = await registerAndGetCookie('contenteditor');
    await grantRole(editor.userId, 'CONTENT_MANAGER');

    const createRes = await fetch(`${BASE_URL}/api/admin/services`, {
      method: 'POST',
      headers: { cookie: editor.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: `admin-route-test-${Date.now()}`,
        name: 'Admin Route Test Service',
        shortDescription: 'For testing',
        longDescriptionHtml: '<p>Test</p>',
      }),
    });
    expect(createRes.status).toBe(201);
    const service = await createRes.json();
    createdServiceIds.push(service.id);

    const patchRes = await fetch(`${BASE_URL}/api/admin/services/${service.id}`, {
      method: 'PATCH',
      headers: { cookie: editor.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed Service' }),
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).name).toBe('Renamed Service');

    // CONTENT_MANAGER does NOT have service.pricing.
    const planRes = await fetch(`${BASE_URL}/api/admin/services/${service.id}/plans`, {
      method: 'POST',
      headers: { cookie: editor.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'admin-test-plan', name: 'Standard', pricePaise: 100000 }),
    });
    expect(planRes.status).toBe(403);
  });

  it('FINANCE (service.pricing) can create/price a plan but cannot edit service copy', async () => {
    const finance = await registerAndGetCookie('financeadmin');
    await grantRole(finance.userId, 'FINANCE');
    const author = await registerAndGetCookie('contenteditor2');
    await grantRole(author.userId, 'CONTENT_MANAGER');

    const createRes = await fetch(`${BASE_URL}/api/admin/services`, {
      method: 'POST',
      headers: { cookie: author.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: `admin-route-test2-${Date.now()}`,
        name: 'Admin Route Test Service 2',
        shortDescription: 'For testing',
        longDescriptionHtml: '<p>Test</p>',
      }),
    });
    const service = await createRes.json();
    createdServiceIds.push(service.id);

    // FINANCE cannot edit copy.
    const copyRes = await fetch(`${BASE_URL}/api/admin/services/${service.id}`, {
      method: 'PATCH',
      headers: { cookie: finance.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Should not work' }),
    });
    expect(copyRes.status).toBe(403);

    // FINANCE can create and price a plan.
    const planRes = await fetch(`${BASE_URL}/api/admin/services/${service.id}/plans`, {
      method: 'POST',
      headers: { cookie: finance.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ key: `admin-test-plan-${Date.now()}`, name: 'Standard', pricePaise: 100000 }),
    });
    expect(planRes.status).toBe(201);
    const plan = await planRes.json();

    // A price change without a reason is rejected by the schema.
    const noReasonRes = await fetch(`${BASE_URL}/api/admin/plans/${plan.id}/price`, {
      method: 'PATCH',
      headers: { cookie: finance.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ pricePaise: 150000 }),
    });
    expect(noReasonRes.status).toBe(400);

    const priceRes = await fetch(`${BASE_URL}/api/admin/plans/${plan.id}/price`, {
      method: 'PATCH',
      headers: { cookie: finance.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ pricePaise: 150000, reason: 'Market adjustment' }),
    });
    expect(priceRes.status).toBe(200);
    expect((await priceRes.json()).pricePaise).toBe(150000);

    const historyRes = await fetch(`${BASE_URL}/api/admin/plans/${plan.id}/price`, {
      headers: { cookie: finance.cookie },
    });
    const { history } = await historyRes.json();
    expect(history).toHaveLength(1);
    expect(history[0].reason).toBe('Market adjustment');
  });

  it('a service created through the admin API is immediately live on the public catalogue page', async () => {
    // A slug not in generateStaticParams' build-time list renders on
    // demand — this proves that on-demand render reads the SAME live rows
    // the admin API just wrote (docs/ARCHITECTURE.md §25's flagship
    // behaviour), not a separate one-time-synced copy. Deactivation's
    // effect on the seam itself (getServiceBySlug returning null) is
    // covered at the library level in tests/catalogue-admin.test.ts —
    // deliberately not re-checked by re-fetching this same page here,
    // since an on-demand-rendered route with no dynamic API calls is a
    // page Next.js may cache, and a second fetch could just return the
    // first render rather than proving anything about live data.
    const author = await registerAndGetCookie('contenteditor3');
    await grantRole(author.userId, 'CONTENT_MANAGER');

    const slug = `admin-live-test-${Date.now()}`;
    const createRes = await fetch(`${BASE_URL}/api/admin/services`, {
      method: 'POST',
      headers: { cookie: author.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        slug,
        name: 'Live Test Service',
        tagline: 'A tagline visible immediately',
        shortDescription: 'x',
        longDescriptionHtml: '<p>Test</p>',
      }),
    });
    const service = await createRes.json();
    createdServiceIds.push(service.id);

    // /[slug] renders name + tagline; shortDescription is the homepage
    // card's copy (src/app/page.tsx) — checked via getServices() at the
    // library level in tests/catalogue-admin.test.ts instead, since
    // fetching `/` here would need to compete with the 3 real seeded
    // services for a match rather than proving anything new.
    const pageRes = await fetch(`${BASE_URL}/${slug}`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toContain('Live Test Service');
    expect(html).toContain('A tagline visible immediately');
  });
});

describe('GET /api/admin/revenue (real server, real Postgres)', () => {
  it('a plain customer gets 403', async () => {
    const plain = await registerAndGetCookie('plainrevenue');
    const res = await fetch(`${BASE_URL}/api/admin/revenue`, { headers: { cookie: plain.cookie } });
    expect(res.status).toBe(403);
  });

  it('FINANCE sees only the revenue section, not the affiliate report', async () => {
    const finance = await registerAndGetCookie('financerevenue');
    await grantRole(finance.userId, 'FINANCE');

    const res = await fetch(`${BASE_URL}/api/admin/revenue`, { headers: { cookie: finance.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revenue).not.toBeNull();
    expect(body.affiliatePerformance).toBeNull();
  });

  it('AFFILIATE_MANAGER sees only the affiliate report, not revenue', async () => {
    const manager = await registerAndGetCookie('affmanagerrevenue');
    await grantRole(manager.userId, 'AFFILIATE_MANAGER');

    const res = await fetch(`${BASE_URL}/api/admin/revenue`, { headers: { cookie: manager.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revenue).toBeNull();
    expect(body.affiliatePerformance).not.toBeNull();
  });
});
