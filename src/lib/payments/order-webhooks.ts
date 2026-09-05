import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliateConversions, commissionEntries, orders, payments } from '@/db/schema';
import { verifyAndRecordPaymentStatus } from './confirm';
import { getPaymentGateway } from './index';
import { reverseConversionCommission } from '@/lib/attribution/commission';
import { transitionOrderStage } from '@/lib/orders/lifecycle';
import { upsertContactForOrder } from '@/lib/crm/contacts';

// The order-side counterpart to src/lib/affiliate/fee.ts's
// confirmAffiliateFeePayment — same verify-then-act shape, but for a
// SERVICE_ORDER payment: mark the order PAID, run it straight on into
// ONBOARDING, create/advance its CRM contact, and approve whatever
// commission entry is riding on it, rather than activating an affiliate.
//
// Only advances order.stage when it's still AWAITING_PAYMENT, via
// src/lib/orders/lifecycle.ts's guarded state machine (never a raw column
// write) — so a replayed webhook or one that arrives after Phase 6's fuller
// order lifecycle has already moved the order further along is a no-op on
// the stage (and the CRM/commission side effects below it), not a
// regression or an error.
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
    await transitionOrderStage(order.id, 'PAID', { note: 'Payment captured' });
    // Chain continues straight into onboarding (docs/ARCHITECTURE.md §8) —
    // there is no manual step between a captured payment and the client
    // seeing their onboarding form.
    await transitionOrderStage(order.id, 'ONBOARDING', { note: 'Onboarding started' });
    await upsertContactForOrder(order.id);
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
