import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { payments, webhookEvents } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { verifyRazorpayWebhookSignature } from '@/lib/payments/webhook-signature';
import { verifyAndRecordPaymentStatus } from '@/lib/payments/confirm';
import { confirmAffiliateFeePayment } from '@/lib/affiliate/fee';
import { handleServiceOrderPaymentCaptured, handleServiceOrderPaymentRefund } from '@/lib/payments/order-webhooks';

// NOTE ON WEBHOOK PAYLOAD SHAPE: the field paths below (event names,
// payload.payment.entity.*, event id) follow Razorpay's published webhook
// documentation but have not been exercised against a real delivery from a
// live Razorpay account in this build (no network access to
// api.razorpay.com from this environment). Phase 13 ("real gateway
// verification... on a machine that can reach the provider") is what
// actually confirms this against real deliveries — treat exact field names
// here as best-effort until that phase runs, the same caveat as
// src/lib/payments/razorpay-gateway.ts.
type RazorpayWebhookPayload = {
  id?: string; // not guaranteed present in every Razorpay webhook format — see idempotency key derivation below
  event: string;
  payload: {
    payment?: { entity: { id: string; order_id: string } };
    refund?: { entity: { id: string; payment_id: string } };
  };
};

export async function POST(request: Request) {
  // Verification MUST run against the untouched raw bytes (rule 7) — read
  // as text before any JSON.parse touches it.
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  const env = getEnv();
  if (!env.RAZORPAY_WEBHOOK_SECRET || !verifyRazorpayWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET)) {
    return Response.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  // Prefer Razorpay's own event id when present; fall back to a hash of
  // the raw body so idempotency still holds even if a given payload shape
  // lacks one — the goal is "the exact same delivery replayed is a no-op,"
  // and a body hash achieves that regardless of whether `id` shows up.
  const providerEventId = payload.id ?? `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;

  const [existing] = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.providerEventId, providerEventId));

  if (existing?.processedAt) {
    // Already fully processed — a true replay. No-op, per rule 9.
    return Response.json({ ok: true, replay: true });
  }

  if (!existing) {
    await db.insert(webhookEvents).values({
      provider: 'razorpay',
      providerEventId,
      eventType: payload.event,
      rawBody,
    });
  }
  // else: a row exists but processedAt is null — a previous attempt at
  // this exact delivery didn't finish (crashed mid-processing, or Razorpay
  // retried before we responded). Fall through and reprocess: every
  // handler below is itself idempotent (verifyAndRecordPaymentStatus just
  // re-records the same status; reverseConversionCommission computes its
  // delta from the ledger; the affiliate activation transition is a no-op
  // once already ACTIVE), so reprocessing is safe.

  try {
    await routeEvent(payload);
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(webhookEvents.providerEventId, providerEventId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(webhookEvents)
      .set({ processingError: message })
      .where(eq(webhookEvents.providerEventId, providerEventId));
    // 500, not 200: this leaves processedAt null, so Razorpay's own retry
    // (or a manual replay) will legitimately try again rather than being
    // silently swallowed as "already handled."
    return Response.json({ error: 'Processing failed' }, { status: 500 });
  }

  return Response.json({ ok: true });
}

async function routeEvent(payload: RazorpayWebhookPayload): Promise<void> {
  switch (payload.event) {
    case 'payment.captured': {
      const entity = payload.payload.payment?.entity;
      if (!entity) throw new Error('payment.captured event missing payment entity');
      const payment = await findPaymentByGatewayOrderId(entity.order_id);
      if (payment.purpose === 'AFFILIATE_FEE') {
        await confirmAffiliateFeePayment(payment.id, entity.id);
      } else {
        await handleServiceOrderPaymentCaptured(payment.id, entity.id);
      }
      return;
    }
    case 'payment.failed': {
      const entity = payload.payload.payment?.entity;
      if (!entity) throw new Error('payment.failed event missing payment entity');
      const payment = await findPaymentByGatewayOrderId(entity.order_id);
      if (payment.purpose === 'AFFILIATE_FEE') {
        await confirmAffiliateFeePayment(payment.id, entity.id);
      } else {
        // Recording the failure alone (no order-stage change, no
        // commission cancellation) — a failed attempt doesn't mean the
        // customer won't retry checkout. Order-level abandonment/
        // cancellation is a Phase 6 concern.
        await verifyAndRecordPaymentStatus(payment.id, entity.id);
      }
      return;
    }
    case 'refund.processed': {
      const paymentEntity = payload.payload.payment?.entity;
      const refundEntity = payload.payload.refund?.entity;
      const razorpayPaymentId = paymentEntity?.id ?? refundEntity?.payment_id;
      if (!razorpayPaymentId) throw new Error('refund.processed event missing a payment id');

      const [payment] = await db.select().from(payments).where(eq(payments.razorpayPaymentId, razorpayPaymentId));
      if (!payment) throw new Error(`No payment found for razorpay payment id: ${razorpayPaymentId}`);

      if (payment.purpose === 'SERVICE_ORDER') {
        await handleServiceOrderPaymentRefund(payment.id, razorpayPaymentId);
      }
      // AFFILIATE_FEE refunds: no commission to reverse (the affiliate's
      // own fee isn't a commissioned sale). Whether a refunded fee should
      // roll the affiliate back out of ACTIVE is a business decision left
      // to an admin action (Phase 9), not automated here.
      return;
    }
    default:
      // Unrecognized event types are acknowledged, not errors — Razorpay's
      // event set can grow, and an event this handler doesn't act on yet
      // is not a processing failure.
      return;
  }
}

async function findPaymentByGatewayOrderId(gatewayOrderId: string): Promise<typeof payments.$inferSelect> {
  const [payment] = await db.select().from(payments).where(eq(payments.razorpayOrderId, gatewayOrderId));
  if (!payment) throw new Error(`No payment found for razorpay order id: ${gatewayOrderId}`);
  return payment;
}
