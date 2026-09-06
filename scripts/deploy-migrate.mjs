// Pure-Node equivalent of ops/migrate.sh, for build environments that have
// Node but not necessarily a `psql` binary (e.g. Vercel's build image) —
// ops/migrate.sh stays the documented path for a human running this from
// their own machine or CI with real Postgres tooling installed; this one
// exists so a deploy platform's build step can run the exact same sequence
// (Drizzle migrations, then the hand-written constraints Drizzle's DSL
// can't express, then a verify pass) with nothing beyond `npm install`.
//
// Safe to run on every single deploy, including ones where nothing
// changed: drizzle-kit migrate tracks what it already applied, every
// statement in drizzle/manual/*.sql is `IF NOT EXISTS`/`DROP ... IF EXISTS`
// before `ADD`, and the seed scripts this is chained with in package.json's
// "vercel-build" are documented idempotent in their own file headers.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must be set');
  process.exit(1);
}

console.log('==> Running Drizzle migrations');
execSync('npx drizzle-kit migrate', { stdio: 'inherit' });

console.log('==> Applying hand-written manual SQL (drizzle/manual/*.sql)');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
});

try {
  const manualDir = path.join(process.cwd(), 'drizzle', 'manual');
  const files = readdirSync(manualDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    console.log(`    ${file}`);
    const sql = readFileSync(path.join(manualDir, file), 'utf8');
    await pool.query(sql);
  }

  console.log('==> Verifying money-invariant indexes/constraints landed');
  const REQUIRED_INDEXES = [
    'commission_one_earning_per_conversion_uidx',
    'payouts_one_open_per_affiliate_uidx',
    'affiliate_kyc_one_active_uidx',
    'webhook_events_provider_event_uidx',
  ];

  let missing = false;
  for (const idx of REQUIRED_INDEXES) {
    const { rows } = await pool.query('select 1 from pg_indexes where indexname = $1', [idx]);
    if (rows.length === 0) {
      console.error(`    MISSING: ${idx}`);
      missing = true;
    }
  }

  const { rows: constraintRows } = await pool.query(
    "select 1 from pg_constraint where conname = 'payouts_net_is_gross_minus_tds'"
  );
  if (constraintRows.length === 0) {
    console.error('    MISSING: payouts_net_is_gross_minus_tds CHECK constraint');
    missing = true;
  }

  if (missing) {
    console.error('==> FAILED: one or more manual constraints did not land. Do not consider migration complete.');
    process.exit(1);
  }

  console.log('==> All manual constraints verified present.');
} finally {
  await pool.end();
}
