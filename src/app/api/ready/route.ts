import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { getEnv } from '@/lib/env';

// Readiness: checks the database, config validation, and (from Phase 4
// onward) that the money-invariant partial unique indexes actually landed —
// a database missing them looks fine until concurrent load finds the gap.
export async function GET() {
  const checks: Record<string, 'ok' | string> = {};

  try {
    getEnv();
    checks.config = 'ok';
  } catch (err) {
    checks.config = err instanceof Error ? err.message : String(err);
  }

  try {
    await db.execute(sql`select 1`);
    checks.database = 'ok';
  } catch (err) {
    checks.database = err instanceof Error ? err.message : String(err);
  }

  try {
    const rows = await db.execute(sql`
      select indexname from pg_indexes
      where indexname in (
        'commission_one_earning_per_conversion_uidx',
        'payouts_one_open_per_affiliate_uidx',
        'affiliate_kyc_one_active_uidx'
      )
    `);
    const found = new Set((rows as unknown as { indexname: string }[]).map((r) => r.indexname));
    const required = [
      'commission_one_earning_per_conversion_uidx',
      'payouts_one_open_per_affiliate_uidx',
      'affiliate_kyc_one_active_uidx',
    ];
    const missing = required.filter((name) => !found.has(name));
    checks.moneyInvariantIndexes = missing.length === 0 ? 'ok' : `missing: ${missing.join(', ')}`;
  } catch (err) {
    checks.moneyInvariantIndexes = err instanceof Error ? err.message : String(err);
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');
  return Response.json({ status: allOk ? 'ready' : 'not_ready', checks }, { status: allOk ? 200 : 503 });
}
