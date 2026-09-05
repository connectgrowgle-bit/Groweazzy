import { db } from '@/db';
import { orders, payments } from '@/db/schema';
import { getPaymentGateway } from '@/lib/payments';
import { resolveServicePlan } from '@/lib/catalogue';
import { resolveAttributedAffiliate } from '@/lib/attribution/resolve';
import { recordConversion } from '@/lib/attribution/commission';

export type InitiateCheckoutResult = {
  orderId: string;
  paymentId: string;
  gatewayOrderId: string;
  amountPaise: number;
};

// Where "Service → checkout" actually happens (docs/ARCHITECTURE.md §8).
// Price is read server-side via resolveServicePlan — the client sends only
// a plan identifier, never an amount (rule 4). Creates the order first
// (AWAITING_PAYMENT), then opens a gateway order against it, matching
// src/lib/affiliate/fee.ts's initiateAffiliateFeePayment shape: an order id
// exists before any client checkout opens, so a payment can never be
// captured without one to attach to.
//
// Attribution is resolved and recorded here too — this is the one place an
// order actually gets placed, which is exactly when recordConversion's own
// doc comment says to call it. A click cookie that doesn't resolve to an
// ACTIVE affiliate (none, expired, suspended) is not a checkout error, just
// an order nobody gets credit for.
export async function initiateCheckout(params: {
  userId: string;
  staticPlanId: string;
}): Promise<InitiateCheckoutResult> {
  const { plan } = await resolveServicePlan(params.staticPlanId);

  const [order] = await db
    .insert(orders)
    .values({ userId: params.userId, servicePlanId: plan.id, amountPaise: plan.pricePaise })
    .returning();
  if (!order) throw new Error('Insert did not return a row');

  const gateway = getPaymentGateway();
  const gatewayOrder = await gateway.createOrder({
    amountPaise: plan.pricePaise,
    receipt: `order-${order.id}`,
    notes: { orderId: order.id, purpose: 'SERVICE_ORDER' },
  });

  const [payment] = await db
    .insert(payments)
    .values({
      purpose: 'SERVICE_ORDER',
      orderId: order.id,
      amountPaise: plan.pricePaise,
      razorpayOrderId: gatewayOrder.gatewayOrderId,
    })
    .returning();
  if (!payment) throw new Error('Insert did not return a row');

  const affiliate = await resolveAttributedAffiliate();
  if (affiliate) {
    await recordConversion({ orderId: order.id, affiliateId: affiliate.id });
  }

  return {
    orderId: order.id,
    paymentId: payment.id,
    gatewayOrderId: gatewayOrder.gatewayOrderId,
    amountPaise: plan.pricePaise,
  };
}
