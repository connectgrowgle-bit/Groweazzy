import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliates, payments } from '@/db/schema';
import { getPaymentGateway } from '@/lib/payments';
import { verifyAndRecordPaymentStatus } from '@/lib/payments/confirm';
import { getCurrentCommissionPolicy } from './commission-policy';
import { transitionAffiliateStatus } from './lifecycle';

export class InvalidStateForFeePaymentError extends Error {
  constructor(currentStatus: string) {
    super(`Cannot initiate fee payment while affiliate status is ${currentStatus}`);
    this.name = 'InvalidStateForFeePaymentError';
  }
}

export async function initiateAffiliateFeePayment(
  affiliateId: string
): Promise<{ payment: typeof payments.$inferSelect; gatewayOrderId: string }> {
  const [affiliate] = await db.select().from(affiliates).where(eq(affiliates.id, affiliateId));
  if (!affiliate) throw new Error(`No such affiliate: ${affiliateId}`);
  if (affiliate.status !== 'FEE_PENDING') {
    throw new InvalidStateForFeePaymentError(affiliate.status);
  }

  // Price is read server-side from the current policy — the client never
  // gets to say what the fee costs, only that it wants to pay it
  // (docs/ARCHITECTURE.md rule 4).
  const policy = await getCurrentCommissionPolicy();
  const amountPaise = policy.registrationFeePaise;

  const gateway = getPaymentGateway();
  const order = await gateway.createOrder({
    amountPaise,
    receipt: `affiliate-fee-${affiliateId}`,
    notes: { affiliateId, purpose: 'AFFILIATE_FEE' },
  });

  const [payment] = await db
    .insert(payments)
    .values({
      purpose: 'AFFILIATE_FEE',
      affiliateId,
      amountPaise,
      razorpayOrderId: order.gatewayOrderId,
    })
    .returning();
  if (!payment) throw new Error('Insert did not return a row');

  return { payment, gatewayOrderId: order.gatewayOrderId };
}

export class PaymentNotCapturedError extends Error {
  constructor(status: string) {
    super(`Payment is not captured (status: ${status}) — cannot activate affiliate from it`);
    this.name = 'PaymentNotCapturedError';
  }
}

// Confirms payment status the only way rule 6 allows: a server-to-server
// fetch from the gateway, never the frontend's word (verifyAndRecordPaymentStatus,
// shared with the Razorpay webhook handler — see src/lib/payments/confirm.ts).
// Records what the gateway said either way; only proceeds to activation on
// a genuine capture.
export async function confirmAffiliateFeePayment(
  paymentId: string,
  gatewayPaymentId: string
): Promise<typeof payments.$inferSelect> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!payment) throw new Error(`No such payment: ${paymentId}`);
  if (payment.purpose !== 'AFFILIATE_FEE' || !payment.affiliateId) {
    throw new Error(`Payment ${paymentId} is not an affiliate fee payment`);
  }

  const updated = await verifyAndRecordPaymentStatus(paymentId, gatewayPaymentId);

  if (updated.status === 'CAPTURED') {
    await activateFromVerifiedPayment(paymentId);
  }

  return updated;
}

// Named "FromVerifiedPayment" on purpose, as a warning to future editors:
// this is exactly the function name that shipped a real bug in the
// original build (docs/ARCHITECTURE.md §9, mistake #7) — it trusted the id
// despite its own name and never actually read the payment row. This
// version re-reads the row FRESH from the database and checks its status,
// purpose, and affiliate linkage itself; it does not trust that whatever
// called it already verified anything, regardless of what the caller above
// looks like it already confirmed.
async function activateFromVerifiedPayment(paymentId: string): Promise<void> {
  const [payment] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!payment) throw new Error(`No such payment: ${paymentId}`);
  if (payment.status !== 'CAPTURED') {
    throw new PaymentNotCapturedError(payment.status);
  }
  if (payment.purpose !== 'AFFILIATE_FEE' || !payment.affiliateId) {
    throw new Error(`Payment ${paymentId} is not a captured affiliate fee payment`);
  }

  await transitionAffiliateStatus(payment.affiliateId, 'ACTIVE', { activatedAt: new Date() });
}
