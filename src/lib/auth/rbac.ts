import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { permissions, rolePermissions, userRoles } from '@/db/schema';
import type { PermissionKey } from './permissions-catalog';

// Resolved per request from the database — never a role-string branch like
// `role === "ADMIN"` anywhere in application code (docs/ARCHITECTURE.md §4).
// This makes access changes a data change (reassign roles, edit
// role_permissions) rather than a deploy.
export async function can(userId: string, permissionKey: PermissionKey): Promise<boolean> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(sql`${userRoles.userId} = ${userId} and ${permissions.key} = ${permissionKey}`);

  return Number(rows[0]?.count ?? 0) > 0;
}

// All permission keys a user currently holds, across every role assigned to
// them — used to render an admin UI's available actions, not for the actual
// authorization decision (which always goes through can() at the point of
// action, per-request, so a mid-session role change takes effect immediately).
export async function getPermissionsForUser(userId: string): Promise<string[]> {
  const rows = await db
    .select({ key: permissions.key })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(userRoles.userId, userId));

  return [...new Set(rows.map((r) => r.key))];
}
