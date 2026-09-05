import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { rateLimitBuckets } from '@/db/schema';

export type RateLimitResult = { allowed: boolean; retryAfterSeconds?: number };

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
