// Seeds real `services`/`service_plans` rows from src/lib/catalogue-seed-data.ts
// — the original Phase 1 marketing copy, preserved there as the one-time
// bootstrap source now that src/lib/repository.ts reads live from the
// database (docs/ARCHITECTURE.md §25). This script's job is that one-time
// (or re-run-to-resync) bootstrap; ongoing catalogue edits go through
// /admin/services (service.edit / service.pricing), not this file.
//
// Idempotent (see seedCatalogueFromRepository's own comment) — safe to run
// on every deploy, including production, same as db:seed:roles.
//
// Run with: npm run db:seed:catalogue

import { seedCatalogueFromRepository } from '../../src/lib/catalogue';
import { SEED_SERVICES } from '../../src/lib/catalogue-seed-data';

async function main() {
  console.log(`Seeding ${SEED_SERVICES.length} services...`);
  await seedCatalogueFromRepository();
  for (const service of SEED_SERVICES) {
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
