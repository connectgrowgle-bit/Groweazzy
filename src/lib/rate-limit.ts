import { eq, lt } from 'drizzle-orm';
import { db } from '@/db';
import { rateLimitBuckets } from '@/db/schema';

export type RateLimitResult = { allowed: boolean; retryAfterSeconds?: number };

// Every distinct key (an email that ever attempted login, an IP that ever
// hit register/contact) leaves a permanent row once created — the fixed
// window itself just resets a key's existing row in place, it never
// deletes one. Left alone that's unbounded growth: a stream of one-off
// registration attempts from distinct throwaway emails, or a botnet
// rotating source IPs, both leave a row apiece forever, even though the
// row stops mattering to anything the moment its window closes. 24h is
// deliberately generous — every windowSeconds this app configures
// (§27/docs) is measured in minutes, so a row this old has been outside
// its window, and therefore inert, for a long time; deleting it changes
// nothing about the next request from that same key (it just starts a
// fresh window, identical to what already happens for any expired row
// that's still sitting there).
const STALE_BUCKET_AGE_MS = 24 * 60 * 60 * 1000;
// Runs opportunistically rather than on a schedule — this app has no cron
// runner wired up yet outside CRON_SECRET-gated endpoints (§12's
// commission scheduler, not yet built), so a low-probability sweep piggy-backed
// on real traffic is the cheapest way to bound the table's size without
// standing up new infrastructure just for this. 1% keeps the extra
// indexed DELETE off the hot path for 99% of calls.
const SWEEP_PROBABILITY = 0.01;

// Exported (not just inlined) so it can also be driven explicitly — e.g.
// from a future ops/cron entry point — without duplicating the query.
export async function sweepStaleRateLimitBuckets(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_BUCKET_AGE_MS);
  const deleted = await db
    .delete(rateLimitBuckets)
    .where(lt(rateLimitBuckets.windowStartAt, cutoff))
    .returning({ key: rateLimitBuckets.key });
  return deleted.length;
}

// Fixed-window counter. Counts every call regardless of what the caller
// does with the result (a mistyped password counts same as a correct one)
// — simpler to reason about than "only failures count," and still
// effective: an attacker trying many passwords against one account gets
// throttled either way.
//
// Always inserts a row for `key` FIRST (`onConflictDoNothing` — a no-op
// once the key exists) before locking it, specifically so `for('update')`
// always has a real row to lock, even on this key's first-ever hit. A
// `SELECT ... FOR UPDATE` against a key with no matching row locks
// nothing — without this first insert, a burst of concurrent requests all
// arriving on a brand-new key could each see "no row" in the same instant
// and each take the "fresh window, count=1" branch, letting more than
// maxAttempts through on exactly the traffic pattern (a sudden burst) this
// limiter exists to catch. The epoch placeholder's window is always
// already "elapsed," so a genuinely fresh key still resets to count=1 on
// the first real pass through the logic below — this only closes the
// concurrency gap, it doesn't change the single-caller behavior.
export async function checkRateLimit(
  key: string,
  opts: { maxAttempts: number; windowSeconds: number }
): Promise<RateLimitResult> {
  if (Math.random() < SWEEP_PROBABILITY) {
    // Best-effort only — a sweep failing (e.g. a transient connection
    // hiccup) must never fail the actual rate-limit check it happened to
    // ride along with.
    void sweepStaleRateLimitBuckets().catch(() => {});
  }

  return db.transaction(async (tx) => {
    await tx
      .insert(rateLimitBuckets)
      .values({ key, count: 0, windowStartAt: new Date(0) })
      .onConflictDoNothing();

    const [existing] = await tx.select().from(rateLimitBuckets).where(eq(rateLimitBuckets.key, key)).for('update');
    if (!existing) throw new Error('Row must exist after the upsert above');

    const now = new Date();
    const windowMs = opts.windowSeconds * 1000;

    if (now.getTime() - existing.windowStartAt.getTime() >= windowMs) {
      await tx.update(rateLimitBuckets).set({ count: 1, windowStartAt: now }).where(eq(rateLimitBuckets.key, key));
      return { allowed: true };
    }

    if (existing.count >= opts.maxAttempts) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.windowStartAt.getTime() + windowMs - now.getTime()) / 1000)
      );
      return { allowed: false, retryAfterSeconds };
    }

    await tx
      .update(rateLimitBuckets)
      .set({ count: existing.count + 1 })
      .where(eq(rateLimitBuckets.key, key));
    return { allowed: true };
  });
}

// A 429 Response pre-built with a spec-correct Retry-After header — every
// call site that hits a limit returns exactly this, so the header is never
// forgotten on one route and present on another.
export function rateLimitedResponse(retryAfterSeconds: number): Response {
  return Response.json(
    { error: 'Too many requests — please try again later' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  );
}
