import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { orders, payments } from '@/db/schema';
import { requireActor } from '@/lib/auth/actor';
import { handleServiceOrderPaymentCaptured } from '@/lib/payments/order-webhooks';
import { logAudit } from '@/lib/auth/audit';

const schema = z.object({ gatewayPaymentId: z.string().min(1) });

// The order-side counterpart to /api/affiliate/fee/confirm: confirms
// payment status the only way rule 6 allows (a server-to-server gateway
// fetch, inside handleServiceOrderPaymentCaptured — never this request
// body's word for it) and then runs the same PAID → ONBOARDING → CRM chain
// the Razorpay webhook triggers automatically. Calling this AND having the
// webhook also fire for the same payment is fine — both funnel through the
// same idempotent verify-then-act helper.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Ownership check before doing anything else — a payment that isn't
  // yours returns 404, not 403 (docs/ARCHITECTURE.md rule 14).
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order || order.userId !== actor.user.id) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, id))
    .orderBy(desc(payments.createdAt))
    .limit(1);
  if (!payment) {
    return Response.json({ error: 'No payment found for this order' }, { status: 409 });
  }

  await handleServiceOrderPaymentCaptured(payment.id, parsed.data.gatewayPaymentId);

  const [updated] = await db.select().from(orders).where(eq(orders.id, id));

  await logAudit({
    actorUserId: actor.user.id,
    action: 'order.checkout.confirm',
    outcome: 'ALLOWED',
    targetType: 'order',
    targetId: id,
    metadata: { stage: updated?.stage },
  });

  return Response.json({ stage: updated?.stage });
}
