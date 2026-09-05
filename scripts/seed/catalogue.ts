// Seeds real `services`/`service_plans` rows from the Phase 1 static
// catalogue (src/lib/repository.ts) so Phase 6 orders have a real
// service_plan row to point servicePlanId at, ahead of Phase 9 formally
// moving the catalogue into the database. This is a bridge, not a
// duplication of truth: prices and copy still live in repository.ts today,
// and this script's only job is to mirror enough of that into rows a
// foreign key can reference.
//
// Idempotent (see seedCatalogueFromRepository's own comment) — safe to run
// on every deploy, including production, same as db:seed:roles. Price is
// re-synced on every run: repository.ts is still the source of truth
// pre-Phase-9, so a price changed there and redeployed should not require a
// separate manual DB edit to take effect.
//
// Run with: npm run db:seed:catalogue

import { seedCatalogueFromRepository } from '../../src/lib/catalogue';
import { getServices } from '../../src/lib/repository';

async function main() {
  const staticServices = await getServices();
  console.log(`Seeding ${staticServices.length} services...`);
  await seedCatalogueFromRepository();
  for (const service of staticServices) {
    console.log(`  ${service.slug}: ${service.plans.length} plan(s)`);
  }
  console.log('Done.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
