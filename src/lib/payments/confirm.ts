import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { payments } from '@/db/schema';
import { getPaymentGateway } from './index';

// The one place a payment row's status is ever set from a gateway status —
// via a server-to-server fetch, never the frontend's word (rule 6). Shared
// by the affiliate fee flow (src/lib/affiliate/fee.ts, triggered manually
// via /api/affiliate/fee/confirm) and the Razorpay webhook handler
// (src/app/api/webhooks/razorpay/route.ts, triggered automatically) — both
// need exactly this and nothing purpose-specific, so it has no opinion
// about what happens next (activating an affiliate, marking an order PAID,
// approving a commission entry) and just returns the updated row for the
// caller to act on.
export async function verifyAndRecordPaymentStatus(
  paymentId: string,
  gatewayPaymentId: string
): Promise<typeof payments.$inferSelect> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!payment) throw new Error(`No such payment: ${paymentId}`);

  const gateway = getPaymentGateway();
  const status = await gateway.fetchPaymentStatus(gatewayPaymentId);

  const [updated] = await db
    .update(payments)
    .set({
      status: status.status === 'captured' ? 'CAPTURED' : status.status === 'failed' ? 'FAILED' : 'AUTHORIZED',
      razorpayPaymentId: gatewayPaymentId,
      amountRefundedPaise: status.amountRefundedPaise,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, paymentId))
    .returning();
  if (!updated) throw new Error('Update did not return a row');

  return updated;
}
