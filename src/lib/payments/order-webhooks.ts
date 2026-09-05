import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliateConversions, commissionEntries, orders, payments } from '@/db/schema';
import { verifyAndRecordPaymentStatus } from './confirm';
import { getPaymentGateway } from './index';
import { reverseConversionCommission } from '@/lib/attribution/commission';

// The order-side counterpart to src/lib/affiliate/fee.ts's
// confirmAffiliateFeePayment — same verify-then-act shape, but for a
// SERVICE_ORDER payment: mark the order PAID and approve whatever
// commission entry is riding on it, rather than activating an affiliate.
//
// Full order lifecycle management (AWAITING_PAYMENT -> ... -> COMPLETED)
// is Phase 6's job; this only takes the one step that's genuinely a
// payment-webhook concern — reacting to a payment capturing — and only
// touches order.stage when it's still AWAITING_PAYMENT, so it never
// clobbers a later stage a fuller order state machine has already moved
// past.
export async function handleServiceOrderPaymentCaptured(
  paymentId: string,
  gatewayPaymentId: string
): Promise<void> {
  const payment = await verifyAndRecordPaymentStatus(paymentId, gatewayPaymentId);
  if (payment.purpose !== 'SERVICE_ORDER' || !payment.orderId) {
    throw new Error(`Payment ${paymentId} is not a service order payment`);
  }
  if (payment.status !== 'CAPTURED') return; // nothing to approve

  const [order] = await db.select().from(orders).where(eq(orders.id, payment.orderId));
  if (!order) throw new Error(`No such order: ${payment.orderId}`);

  if (order.stage === 'AWAITING_PAYMENT') {
    await db.update(orders).set({ stage: 'PAID', updatedAt: new Date() }).where(eq(orders.id, order.id));
  }

  // A payment capturing is what turns a tentative PENDING commission into
  // one that's actually backed by real, captured money — approve it. Only
  // acts on PENDING specifically: a replayed webhook (or one that arrives
  // after the entry has already progressed further, e.g. an admin action)
  // must not regress or duplicate anything.
  const [conversion] = await db.select().from(affiliateConversions).where(eq(affiliateConversions.orderId, order.id));
  if (conversion) {
    await db
      .update(commissionEntries)
      .set({ status: 'APPROVED' })
      .where(
        and(
          eq(commissionEntries.conversionId, conversion.id),
          eq(commissionEntries.type, 'EARNING'),
          eq(commissionEntries.status, 'PENDING')
        )
      );
  }
}

// Reverses commission proportional to whatever Razorpay's OWN cumulative
// amount_refunded says right now — re-fetched fresh via the gateway rather
// than trusted from the webhook payload's (possibly per-refund, not
// cumulative) amount, matching reverseConversionCommission's own
// idempotency contract (docs/ARCHITECTURE.md §6, §21).
export async function handleServiceOrderPaymentRefund(paymentId: string, gatewayPaymentId: string): Promise<void> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!payment) throw new Error(`No such payment: ${paymentId}`);
  if (payment.purpose !== 'SERVICE_ORDER' || !payment.orderId) {
    throw new Error(`Payment ${paymentId} is not a service order payment`);
  }

  const gateway = getPaymentGateway();
  const status = await gateway.fetchPaymentStatus(gatewayPaymentId);

  await db
    .update(payments)
    .set({ amountRefundedPaise: status.amountRefundedPaise, updatedAt: new Date() })
    .where(eq(payments.id, paymentId));

  const [conversion] = await db
    .select()
    .from(affiliateConversions)
    .where(eq(affiliateConversions.orderId, payment.orderId));
  if (!conversion) return; // no attribution on this order — nothing to reverse

  await reverseConversionCommission({
    orderId: payment.orderId,
    orderAmountPaise: payment.amountPaise,
    cumulativeAmountRefundedPaise: status.amountRefundedPaise,
  });
}
