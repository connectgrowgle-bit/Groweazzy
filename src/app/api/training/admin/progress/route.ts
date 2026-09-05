import { z } from 'zod';
import { requirePermission } from '@/lib/auth/actor';
import { getAllProgressForVideo, getVideoCompletionSummary } from '@/lib/training/reporting';

const schema = z.object({ videoId: z.string().uuid() });

// training.progress.view_all — "how many affiliates have actually finished
// this video," not something exposed to a learner's own progress view.
export async function GET(request: Request) {
  const actor = await requirePermission('training.progress.view_all');
  if (actor instanceof Response) return actor;

  const parsed = schema.safeParse({ videoId: new URL(request.url).searchParams.get('videoId') });
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [rows, summary] = await Promise.all([
    getAllProgressForVideo(parsed.data.videoId),
    getVideoCompletionSummary(parsed.data.videoId),
  ]);

  return Response.json({ rows, summary });
}
