import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { trainingProgress } from '@/db/schema';
import { getPublishedVideoWithContext } from './catalogue';

// A lesson completes at 90% watched, not 100% (docs/ARCHITECTURE.md §10) —
// video players routinely under-report the final second or two.
const COMPLETION_THRESHOLD = 0.9;

export class VideoNotAccessibleError extends Error {
  constructor(videoId: string) {
    super(`Video ${videoId} does not exist, or is not currently published`);
    this.name = 'VideoNotAccessibleError';
  }
}

// Progress is monotonic (never regresses on a re-watch or a seek
// backward), sticky once complete (a later partial rewatch below 90%
// never un-completes a lesson), and clamped to the video's own real
// duration (a client reporting garbage can't inflate a completion
// percentage past what the video actually contains).
//
// Row-locked (`for('update')`) inside a transaction rather than expressed
// as a single `GREATEST(...)`-on-conflict statement — Drizzle can't
// express that declaratively (see the schema's own comment on this table),
// and computing both the clamped/monotonic seconds AND the sticky
// completedAt from the same read is simpler done in JS under a lock than
// split across a raw SQL expression.
export async function recordProgress(
  userId: string,
  videoId: string,
  reportedSecondsWatched: number
): Promise<typeof trainingProgress.$inferSelect> {
  const found = await getPublishedVideoWithContext(videoId);
  if (!found) throw new VideoNotAccessibleError(videoId);

  const clamped = Math.max(0, Math.min(reportedSecondsWatched, found.video.durationSeconds));

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(trainingProgress)
      .where(and(eq(trainingProgress.userId, userId), eq(trainingProgress.videoId, videoId)))
      .for('update');

    const secondsWatched = Math.max(existing?.secondsWatched ?? 0, clamped);
    // Sticky: once completedAt is set, it is never recomputed or cleared —
    // only a still-null completedAt is ever a candidate to become non-null.
    const justCrossedThreshold = secondsWatched / found.video.durationSeconds >= COMPLETION_THRESHOLD;
    const completedAt = existing?.completedAt ?? (justCrossedThreshold ? new Date() : null);

    if (existing) {
      const [updated] = await tx
        .update(trainingProgress)
        .set({ secondsWatched, completedAt, updatedAt: new Date() })
        .where(eq(trainingProgress.id, existing.id))
        .returning();
      if (!updated) throw new Error('Update did not return a row');
      return updated;
    }

    const [created] = await tx
      .insert(trainingProgress)
      .values({ userId, videoId, secondsWatched, completedAt })
      .returning();
    if (!created) throw new Error('Insert did not return a row');
    return created;
  });
}

// A learner's own progress across a course they can see — used by
// /training/[courseId] to show a checkmark/percentage per video without a
// separate request per video.
export async function getProgressForUser(
  userId: string,
  videoIds: string[]
): Promise<Map<string, typeof trainingProgress.$inferSelect>> {
  if (videoIds.length === 0) return new Map();
  const rows = await db.select().from(trainingProgress).where(eq(trainingProgress.userId, userId));
  const byVideo = new Map(rows.map((r) => [r.videoId, r]));
  const filtered = new Map<string, typeof trainingProgress.$inferSelect>();
  for (const id of videoIds) {
    const row = byVideo.get(id);
    if (row) filtered.set(id, row);
  }
  return filtered;
}
