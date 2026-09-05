// Seeds the permission catalogue and default roles from
// src/lib/auth/permissions-catalog.ts. Idempotent — safe to run on every
// deploy, including production, unlike the demo-data seed (kept as a
// separate script so production never accidentally runs the one that
// creates test accounts — see docs/ARCHITECTURE.md deliverables list).
//
// Run with: npm run db:seed:roles

import { seedRolesAndPermissions } from '../../src/lib/auth/seed-rbac';
import { PERMISSIONS, ROLES } from '../../src/lib/auth/permissions-catalog';

async function main() {
  console.log(`Seeding ${PERMISSIONS.length} permissions and ${ROLES.length} roles...`);
  await seedRolesAndPermissions();
  for (const role of ROLES) {
    console.log(`  ${role.key}: ${role.permissions.length} permissions`);
  }
  console.log('Done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
