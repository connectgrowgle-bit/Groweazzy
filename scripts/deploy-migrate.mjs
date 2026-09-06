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
import { lookup } from 'node:dns/promises';
import path from 'node:path';
import pg from 'pg';
import { parse as parseConnectionString } from 'pg-connection-string';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must be set');
  process.exit(1);
}

// A bad DATABASE_URL (a stray newline/space from copy-pasting into a
// dashboard's env var field, a missing/extra character, the wrong var
// entirely) surfaces from drizzle-kit as a bare `getaddrinfo ENOTFOUND
// <garbage>` several layers down a stack trace — technically accurate,
// useless for figuring out what's actually wrong. Parsing it up front and
// printing (never the password) what this run is ABOUT to connect to,
// then failing fast with a real DNS lookup if that host doesn't resolve,
// turns that into an actionable first line of build output instead.
const parsed = parseConnectionString(process.env.DATABASE_URL);
console.log(
  `==> DATABASE_URL parsed as: host=${parsed.host ?? '(missing)'} port=${parsed.port || 5432} database=${parsed.database ?? '(missing)'} user=${parsed.user ?? '(missing)'}`
);
if (!parsed.host) {
  console.error(
    '==> FAILED: DATABASE_URL has no host — check the value saved in your deploy platform for a stray newline, missing characters, or truncation.'
  );
  process.exit(1);
}
try {
  // A DNS lookup normally resolves in milliseconds; capped at 10s so a
  // genuinely unreachable host fails fast with a clear message instead of
  // hanging until the whole build times out.
  await Promise.race([
    lookup(parsed.host),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out after 10s')), 10_000)),
  ]);
} catch (err) {
  console.error(
    `==> FAILED: could not resolve host "${parsed.host}" (${err instanceof Error ? err.message : String(err)}). ` +
      'Re-check the DATABASE_URL saved in your deploy platform against your database provider\'s connection string, ' +
      'exactly — a re-paste with no leading/trailing whitespace usually fixes this.'
  );
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
