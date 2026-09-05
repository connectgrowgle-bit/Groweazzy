import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getEnv } from '@/lib/env';
import * as schema from './schema';

let pool: Pool | null = null;

// Lazily created so importing this module (e.g. from a Zod-validated route
// that hasn't touched the DB yet) never fails just because DATABASE_URL is
// momentarily unset in a test harness.
function getPool(): Pool {
  if (pool) return pool;
  const env = getEnv();
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
  });
  return pool;
}

export const db = drizzle(getPool(), { schema });

// The commission scheduler needs its advisory lock on a connection it holds
// for the whole run, not one borrowed from the shared pool — see
// docs/ARCHITECTURE.md §12. Pool.connect() checks a client out for exclusive
// use until the caller releases it.
export async function getDedicatedConnection() {
  const client = await getPool().connect();
  return client;
}
