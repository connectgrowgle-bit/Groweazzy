import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { trainingProgress, users } from '@/db/schema';

// training.progress.view_all only — every learner's progress on one video,
// for a staff reporting screen (e.g. "how many affiliates have actually
// finished module 3"), not something a learner's own dashboard calls.
export async function getAllProgressForVideo(
  videoId: string
): Promise<{ userId: string; email: string; secondsWatched: number; completedAt: Date | null }[]> {
  const rows = await db
    .select({
      userId: trainingProgress.userId,
      email: users.email,
      secondsWatched: trainingProgress.secondsWatched,
      completedAt: trainingProgress.completedAt,
    })
    .from(trainingProgress)
    .innerJoin(users, eq(users.id, trainingProgress.userId))
    .where(eq(trainingProgress.videoId, videoId));
  return rows;
}

export async function getVideoCompletionSummary(
  videoId: string
): Promise<{ totalStarted: number; totalCompleted: number }> {
  const rows = await db.select().from(trainingProgress).where(eq(trainingProgress.videoId, videoId));
  return {
    totalStarted: rows.length,
    totalCompleted: rows.filter((r) => r.completedAt).length,
  };
}
