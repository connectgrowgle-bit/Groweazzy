import 'dotenv/config';

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
// NOT default. Set these in the environment (or a .env.test.local) to
// override for a specific run; nothing here is a real credential.
const TEST_ENV_DEFAULTS: Record<string, string> = {
  APP_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  DATABASE_SSL: 'false',
  SESSION_SECRET: 'test-only-session-secret-at-least-32-characters-long',
  PII_ENCRYPTION_KEY: '0'.repeat(64),
  PAYMENT_PROVIDER: 'mock',
  PAYMENT_MODE: 'test',
  CRON_SECRET: 'test-only-cron-secret',
  EMAIL_PROVIDER: 'console',
  STORAGE_DRIVER: 'local',
};

for (const [key, value] of Object.entries(TEST_ENV_DEFAULTS)) {
  if (!process.env[key]) process.env[key] = value;
}
