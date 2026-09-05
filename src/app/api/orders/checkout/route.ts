import { z } from 'zod';
import { requireActor } from '@/lib/auth/actor';
import { initiateCheckout } from '@/lib/orders/checkout';
import { CataloguePlanNotSeededError } from '@/lib/catalogue';

const schema = z.object({ planId: z.string().min(1) });

// "Service → checkout" (docs/ARCHITECTURE.md §8). The client sends only a
// plan identifier — the amount charged always comes from initiateCheckout's
// own server-side price lookup (rule 4), never from this request body.
export async function POST(request: Request) {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await initiateCheckout({ userId: actor.user.id, staticPlanId: parsed.data.planId });
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof CataloguePlanNotSeededError) {
      return Response.json({ error: 'Unknown plan' }, { status: 404 });
    }
    throw err;
  }
}
