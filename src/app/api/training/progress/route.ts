import { z } from 'zod';
import { requireActor } from '@/lib/auth/actor';
import { canAccessTraining } from '@/lib/training/access';
import { recordProgress, VideoNotAccessibleError } from '@/lib/training/progress';

const schema = z.object({ videoId: z.string().uuid(), secondsWatched: z.number().min(0) });

// The player page calls this periodically (throttled client-side) as the
// video plays. recordProgress itself independently re-verifies the video
// is published (VideoNotAccessibleError -> 404) — the canAccessTraining
// check here is the coarser "can this user use training AT ALL" gate.
export async function POST(request: Request) {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  if (!(await canAccessTraining(actor.user.id))) {
    return Response.json({ error: 'Training is available to active affiliates' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const progress = await recordProgress(actor.user.id, parsed.data.videoId, parsed.data.secondsWatched);
    return Response.json(progress);
  } catch (err) {
    if (err instanceof VideoNotAccessibleError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
