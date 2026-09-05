import { requireActor } from '@/lib/auth/actor';
import { canAccessTraining } from '@/lib/training/access';
import { getPublishedCourses } from '@/lib/training/catalogue';

// Learner-facing course list — published only (docs/ARCHITECTURE.md §10),
// gated to ACTIVE affiliates (or staff who can author, previewing what's
// live) via canAccessTraining — see its own doc comment for why.
export async function GET() {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  if (!(await canAccessTraining(actor.user.id))) {
    return Response.json({ error: 'Training is available to active affiliates' }, { status: 403 });
  }

  const courses = await getPublishedCourses();
  return Response.json({ courses });
}
