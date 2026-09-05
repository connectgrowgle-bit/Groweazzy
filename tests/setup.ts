import 'dotenv/config';
import { SHARED_TEST_ENV } from './test-env-constants';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL must point at a real, migrated Postgres test database to run tests. ' +
      'See README.md — this suite intentionally does not mock the database.'
  );
}

if (!/test/.test(process.env.DATABASE_URL)) {
  // Cheap guard against accidentally pointing the test suite at a real
  // dev/staging/production database — tests insert and delete real rows.
  throw new Error(
    `DATABASE_URL ("${process.env.DATABASE_URL}") does not look like a test database ` +
      '(expected "test" somewhere in the connection string). Refusing to run.'
  );
}

// Fixed, non-secret defaults for the rest of getEnv()'s required
// configuration (src/lib/env.ts) — only DATABASE_URL identifies which real
// database a test run hits, so that's the one thing this deliberately does
// NOT default. SESSION_SECRET/PII_ENCRYPTION_KEY/CRON_SECRET come from
// SHARED_TEST_ENV (tests/test-env-constants.ts) — this process (direct
// library calls) and the server tests/global-setup.ts spawns (HTTP-level
// calls) MUST agree on these exact values, or anything that signs
// something in one process and verifies it in the other (e.g.
// tests/attribution-routes.test.ts) fails looking like a real bug.
const TEST_ENV_DEFAULTS: Record<string, string> = {
  APP_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  DATABASE_SSL: 'false',
  ...SHARED_TEST_ENV,
  PAYMENT_PROVIDER: 'mock',
  PAYMENT_MODE: 'test',
  EMAIL_PROVIDER: 'console',
  STORAGE_DRIVER: 'local',
  // Set here only, not in SHARED_TEST_ENV — see that file's own comment on
  // why this one value is deliberately allowed to differ from the spawned
  // HTTP test server's env.
  TRUSTED_PROXY_HEADER: 'x-forwarded-for',
};

for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}
