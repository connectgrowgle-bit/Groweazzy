import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, withAdvisoryLock } from '@/db';
import { jobRuns } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { releaseMaturedCommissions } from '@/lib/attribution/commission-scheduler';

const JOB_NAME = 'release_matured_commissions';
// Arbitrary, fixed, and documented so this job's advisory lock (§12,
// src/db/index.ts's withAdvisoryLock) can never accidentally collide with
// a future scheduled job's own key.
const ADVISORY_LOCK_KEY = 727001n;

function isAuthorized(request: Request, cronSecret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(cronSecret);
  if (providedBuf.length === 0 || providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

// Triggered by an external scheduler (this app runs none of its own) —
// hits `releaseMaturedCommissions` (src/lib/attribution/commission-scheduler.ts)
// under an advisory lock, and records the run in `job_runs` either way.
//
// docs/ARCHITECTURE.md §12 originally called for a 503 when CRON_SECRET
// isn't configured — by the time this build actually reached this phase,
// src/lib/env.ts had already made CRON_SECRET mandatory at boot (`z.string()
// .min(16)`, no `.optional()`), so that state is unreachable: the whole app
// refuses to start without it (src/instrumentation.ts), never mind this one
// route. The only real-world failure mode left is a missing or wrong
// bearer token, so that's the only case handled here.
async function handleTrigger(request: Request): Promise<Response> {
  const env = getEnv();
  if (!isAuthorized(request, env.CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await withAdvisoryLock(ADVISORY_LOCK_KEY, async () => {
    const [run] = await db.insert(jobRuns).values({ jobName: JOB_NAME }).returning();
    if (!run) throw new Error('Insert did not return a row');

    try {
      const summary = await releaseMaturedCommissions();
      await db
        .update(jobRuns)
        .set({
          finishedAt: new Date(),
          status: summary.failed > 0 ? 'FAILED' : 'SUCCEEDED',
          itemsProcessed: summary.released,
          itemsFailed: summary.failed,
          // Skip reasons (a suspended affiliate, a cancelled order, a
          // refund) are expected outcomes, not failures, but still worth
          // recording somewhere a human can see them — §12's "reversal
          // failures need their own alerting, not just log lines nobody
          // reads" applies just as much to a run that quietly skipped
          // dozens of entries for the same reason.
          errorSummary: summary.notes.length > 0 ? summary.notes.join('\n') : null,
        })
        .where(eq(jobRuns.id, run.id));
      return summary;
    } catch (err) {
      await db
        .update(jobRuns)
        .set({ finishedAt: new Date(), status: 'FAILED', errorSummary: err instanceof Error ? err.message : String(err) })
        .where(eq(jobRuns.id, run.id));
      throw err;
    }
  });

  if (result === null) {
    // Another instance's run is already holding the lock — expected when
    // an external scheduler retries or overlaps two triggers, not an
    // error condition worth a non-2xx status.
    return Response.json({ status: 'already_running' });
  }

  return Response.json({ status: 'completed', ...result });
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleTrigger(request);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}

// Accepted alongside POST — some schedulers (e.g. a platform's built-in
// cron trigger) only ever send GET, and this action is idempotent-safe to
// trigger either way (an overlapping run is a no-op via the advisory lock
// above, never a double-release).
export async function GET(request: Request): Promise<Response> {
  return POST(request);
}
