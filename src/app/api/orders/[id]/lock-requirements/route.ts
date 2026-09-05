import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { requirePermission } from '@/lib/auth/actor';
import { lockRequirements, OnboardingNotSubmittedError } from '@/lib/orders/lock';
import { InvalidOrderTransitionError } from '@/lib/orders/lifecycle';
import { logAudit } from '@/lib/auth/audit';

// Staff-only, explicit, one-way (docs/ARCHITECTURE.md §8): `order.update_stage`
// (STAFF holds this by default). There is no corresponding "unlock" route.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('order.update_stage');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) return Response.json({ error: 'Not found' }, { status: 404 });

  try {
    const updated = await lockRequirements(id, actor.user.id);
    await logAudit({
      actorUserId: actor.user.id,
      action: 'order.lock_requirements',
      outcome: 'ALLOWED',
      targetType: 'order',
      targetId: id,
    });
    return Response.json({ stage: updated.stage, requirementsLockedAt: updated.requirementsLockedAt });
  } catch (err) {
    if (err instanceof OnboardingNotSubmittedError || err instanceof InvalidOrderTransitionError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
