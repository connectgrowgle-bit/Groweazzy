import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { roles, userRoles } from '@/db/schema';
import { can, getPermissionsForUser } from '@/lib/auth/rbac';
import { seedRolesAndPermissions } from '@/lib/auth/seed-rbac';
import { ROLES } from '@/lib/auth/permissions-catalog';
import { createTestUser, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];

beforeAll(async () => {
  // Idempotent — safe to call even if the catalogue is already seeded from
  // a prior run or scripts/seed/roles-permissions.ts against this DB.
  await seedRolesAndPermissions();
});

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

async function assignRole(userId: string, roleKey: string) {
  const [role] = await db.select().from(roles).where(eq(roles.key, roleKey));
  if (!role) throw new Error(`Role ${roleKey} not found — did seedRolesAndPermissions() run?`);
  await db.insert(userRoles).values({ userId, roleId: role.id });
}

describe('RBAC: can()', () => {
  it('a user with no roles has no permissions', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);

    expect(await can(user.id, 'payout.approve')).toBe(false);
    expect(await getPermissionsForUser(user.id)).toEqual([]);
  });

  it('FINANCE can approve payouts but cannot review affiliate KYC', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    await assignRole(user.id, 'FINANCE');

    expect(await can(user.id, 'payout.approve')).toBe(true);
    expect(await can(user.id, 'affiliate.kyc.review')).toBe(false);
  });

  it("CONTENT_MANAGER can edit a service but cannot reprice it — service.edit and service.pricing are separate permissions", async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    await assignRole(user.id, 'CONTENT_MANAGER');

    expect(await can(user.id, 'service.edit')).toBe(true);
    expect(await can(user.id, 'service.pricing')).toBe(false);
  });

  it('ADMIN holds every permission in the current catalogue', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    await assignRole(user.id, 'ADMIN');

    const adminRoleDef = ROLES.find((r) => r.key === 'ADMIN');
    if (!adminRoleDef) throw new Error('ADMIN role missing from catalogue');

    const granted = await getPermissionsForUser(user.id);
    // Derived from the catalogue, not a hardcoded count — this test should
    // not need updating just because someone legitimately adds a permission.
    expect(granted.sort()).toEqual([...adminRoleDef.permissions].sort());
  });

  it('a permission change takes effect on the very next check — no caching', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);

    expect(await can(user.id, 'crm.view')).toBe(false);
    await assignRole(user.id, 'STAFF');
    expect(await can(user.id, 'crm.view')).toBe(true);
  });
});
