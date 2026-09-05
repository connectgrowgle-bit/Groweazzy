import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { requireActor } from '@/lib/auth/actor';
import { can } from '@/lib/auth/rbac';
import { InvalidOrderTransitionError, transitionOrderStage } from '@/lib/orders/lifecycle';
import { cancelConversionCommission, ConversionNotFoundError } from '@/lib/attribution/commission';
import { logAudit } from '@/lib/auth/audit';

// The owner, or staff with order.cancel, can call off an order at any
// non-terminal stage (transitionOrderStage's ALLOWED_TRANSITIONS map).
//
// Only cancels the riding commission entry when the order was still
// AWAITING_PAYMENT — cancelConversionCommission only touches a PENDING
// entry, and by the time an order reaches PAID its commission has already
// been APPROVED (payment capture does that, see order-webhooks.ts). An
// order cancelled after payment captured is a CANCELLED order with money
// already collected; unwinding that commission, if it's ever unwound, goes
// through the refund webhook's reverseConversionCommission, same as any
// other refund — not through this route pretending the sale never
// happened (docs/ARCHITECTURE.md §6: CANCELLED vs REVERSED are not the
// same idea under different names).
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) return Response.json({ error: 'Not found' }, { status: 404 });

  const isOwner = order.userId === actor.user.id;
  if (!isOwner && !(await can(actor.user.id, 'order.cancel'))) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const wasPrePayment = order.stage === 'AWAITING_PAYMENT';

  try {
    const updated = await transitionOrderStage(id, 'CANCELLED', {
      actorUserId: actor.user.id,
      note: 'Cancelled',
    });

    if (wasPrePayment) {
      try {
        await cancelConversionCommission(id);
      } catch (err) {
        if (!(err instanceof ConversionNotFoundError)) throw err;
      }
    }

    await logAudit({
      actorUserId: actor.user.id,
      action: 'order.cancel',
      outcome: 'ALLOWED',
      targetType: 'order',
      targetId: id,
    });

    return Response.json({ stage: updated.stage });
  } catch (err) {
    if (err instanceof InvalidOrderTransitionError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
