import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Reads DATABASE_URL/DATABASE_SSL directly from process.env rather than
// through getEnv() (src/lib/env.ts) on purpose: getEnv() validates the
// *entire* app configuration (Razorpay keys, session secret, cron secret,
// ...), which standalone scripts (drizzle-kit, scripts/seed/*) that only
// need a database connection shouldn't have to satisfy. The full
// cross-checked validation still runs — see src/instrumentation.ts, which
// calls getEnv() once at Next.js server boot and refuses to start the app
// on a mismatch. drizzle.config.ts follows this same pattern.
function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  return new Pool({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
}

const pool = getPool();

export const db = drizzle(pool, { schema });

// The commission scheduler needs its advisory lock on a connection it holds
// for the whole run, not one borrowed from the shared pool — see
// docs/ARCHITECTURE.md §12. Pool.connect() checks a client out for exclusive
// use until the caller releases it.
export async function getDedicatedConnection() {
  const client = await pool.connect();
  return client;
}
