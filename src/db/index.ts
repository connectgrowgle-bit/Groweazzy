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

// Postgres advisory locks are SESSION-scoped, not transaction-scoped — the
// lock lives on whichever connection took it, for as long as that
// connection holds it, regardless of transaction boundaries. Taken against
// a connection borrowed from `db`'s shared pool, `pg_advisory_lock` would
// hand the "same" lock to a second concurrent run the instant the pool
// recycles that same physical connection to it — not a rare edge case, the
// default behavior of a pooled advisory lock. `getDedicatedConnection()`
// above exists specifically so a lock's lifetime matches one exclusively
// held connection instead.
//
// `key` is a plain bigint, not a string — callers pick a fixed, documented
// constant per distinct lock (e.g. one per scheduled job) so two unrelated
// jobs can never collide by accident. Returns `null` without running `fn`
// if the lock is already held elsewhere (another instance's overlapping
// run) — the caller decides what "already running" means for their own
// job rather than this helper guessing.
export async function withAdvisoryLock<T>(key: bigint, fn: () => Promise<T>): Promise<T | null> {
  const client = await getDedicatedConnection();
  try {
    const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [key]);
    if (!rows[0]?.locked) return null;

    try {
      return await fn();
    } finally {
      // Best-effort: an unlock that fails to reach Postgres (e.g. the
      // connection just dropped) still releases the lock, since Postgres
      // drops every advisory lock a session held the moment that session's
      // connection closes — client.release() below ends this one.
      await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => {});
    }
  } finally {
    client.release();
  }
}
