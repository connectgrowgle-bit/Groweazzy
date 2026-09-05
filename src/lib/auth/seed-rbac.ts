// Core logic for seeding the permission catalogue and default roles from
// permissions-catalog.ts. Exported separately from
// scripts/seed/roles-permissions.ts so tests can call it directly against
// the test database instead of shelling out to the script or duplicating
// the upsert logic.
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { permissions, rolePermissions, roles } from '@/db/schema';
import { PERMISSIONS, ROLES } from './permissions-catalog';

export async function seedRolesAndPermissions(): Promise<void> {
  for (const perm of PERMISSIONS) {
    await db
      .insert(permissions)
      .values({ key: perm.key, description: perm.description })
      .onConflictDoUpdate({ target: permissions.key, set: { description: perm.description } });
  }

  for (const role of ROLES) {
    const [roleRow] = await db
      .insert(roles)
      .values({ key: role.key, label: role.label })
      .onConflictDoUpdate({ target: roles.key, set: { label: role.label } })
      .returning();
    if (!roleRow) throw new Error(`Failed to upsert role ${role.key}`);

    const permRows = await db.select().from(permissions);
    const permIdByKey = new Map(permRows.map((p) => [p.key, p.id]));

    // Replace this role's permission set atomically rather than diffing —
    // simpler and the catalogue is small enough that this is cheap.
    await db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleRow.id));
      const wantedPermissionIds = role.permissions
        .map((key) => permIdByKey.get(key))
        .filter((id): id is string => Boolean(id));
      if (wantedPermissionIds.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(wantedPermissionIds.map((permissionId) => ({ roleId: roleRow.id, permissionId })));
      }
    });
  }
}
