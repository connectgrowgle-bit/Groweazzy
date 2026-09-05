import { createHmac } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliates, commissionEntries, affiliateConversions, crmContacts, orders, payments, webhookEvents } from '@/db/schema';
import { POST } from '@/app/api/webhooks/razorpay/route';
import { getPaymentGateway, MockPaymentGateway } from '@/lib/payments';
import { initiateAffiliateFeePayment } from '@/lib/affiliate/fee';
import { recordConversion } from '@/lib/attribution/commission';
import { createTestAffiliate, createTestOrder, deleteTestOrder, deleteTestUser } from './helpers';
import { SHARED_TEST_ENV } from './test-env-constants';

const WEBHOOK_URL = 'http://localhost/api/webhooks/razorpay';

function signedRequest(payload: object, secret = SHARED_TEST_ENV.RAZORPAY_WEBHOOK_SECRET): Request {
  const rawBody = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(rawBody).digest('hex');
  return new Request(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'x-razorpay-signature': signature, 'content-type': 'application/json' },
    body: rawBody,
  });
}

function mockGateway(): MockPaymentGateway {
  const gateway = getPaymentGateway();
  if (!(gateway instanceof MockPaymentGateway)) throw new Error('Expected PAYMENT_PROVIDER=mock for this test run');
  return gateway;
}

const createdUserIds: string[] = [];
const createdOrderIds: string[] = [];
const createdWebhookEventIds: string[] = [];

afterEach(async () => {
  while (createdWebhookEventIds.length) {
    const id = createdWebhookEventIds.pop();
    if (id) await db.delete(webhookEvents).where(eq(webhookEvents.providerEventId, id));
  }
  while (createdOrderIds.length) {
    const id = createdOrderIds.pop();
    if (id) await deleteTestOrder(id);
  }
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('Razorpay webhook: signature and idempotency', () => {
  it('rejects a request with an invalid signature — no webhookEvents row is created', async () => {
    const eventId = `evt_test_${Date.now()}_bad_sig`;
    createdWebhookEventIds.push(eventId);
    const res = await POST(signedRequest({ id: eventId, event: 'payment.captured', payload: {} }, 'wrong-secret'));
    expect(res.status).toBe(400);

    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.providerEventId, eventId));
    expect(row).toBeUndefined();
  });

  it('acknowledges an unrecognized event type without error', async () => {
    const eventId = `evt_test_${Date.now()}_unknown`;
    createdWebhookEventIds.push(eventId);
    const res = await POST(signedRequest({ id: eventId, event: 'some.future.event', payload: {} }));
    expect(res.status).toBe(200);

    const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.providerEventId, eventId));
    expect(row?.processedAt).not.toBeNull();
  });

  it('a replayed delivery (same event id) is a no-op the second time', async () => {
    const eventId = `evt_test_${Date.now()}_replay`;
    createdWebhookEventIds.push(eventId);
    const payload = { id: eventId, event: 'some.future.event', payload: {} };

    const first = await POST(signedRequest(payload));
    expect((await first.json()).replay).toBeUndefined();

    const second = await POST(signedRequest(payload));
    expect((await second.json()).replay).toBe(true);

    const rows = await db.select().from(webhookEvents).where(eq(webhookEvents.providerEventId, eventId));
    expect(rows).toHaveLength(1);
  });
});

describe('Razorpay webhook: payment.captured', () => {
  it('activates an affiliate on their fee payment capturing', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'FEE_PENDING' });
    createdUserIds.push(user.id);
    const { payment, gatewayOrderId } = await initiateAffiliateFeePayment(affiliate.id);
    const { gatewayPaymentId } = await mockGateway().simulateCapture(gatewayOrderId);

    const eventId = `evt_test_${payment.id}_captured`;
    createdWebhookEventIds.push(eventId);
    const res = await POST(
      signedRequest({
        id: eventId,
        event: 'payment.captured',
        payload: { payment: { entity: { id: gatewayPaymentId, order_id: gatewayOrderId } } },
      })
    );
    expect(res.status).toBe(200);

    const [affiliateRow] = await db.select().from(affiliates).where(eq(affiliates.id, affiliate.id));
    expect(affiliateRow?.status).toBe('ACTIVE');
    const [paymentRow] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(paymentRow?.status).toBe('CAPTURED');
  });

  it('marks a service order PAID, runs it into ONBOARDING, creates its CRM contact, and approves its PENDING commission entry', async () => {
    const { user: buyerUser } = await createTestAffiliate({ status: 'ACTIVE' }); // just need any user; affiliate unused here
    createdUserIds.push(buyerUser.id);
    const { user: refUser, affiliate: referrer } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(refUser.id);

    const order = await createTestOrder({ userId: buyerUser.id, amountPaise: 1000000, stage: 'AWAITING_PAYMENT' });
    createdOrderIds.push(order.id);
    const { entry } = await recordConversion({ orderId: order.id, affiliateId: referrer.id });
    expect(entry.status).toBe('PENDING');

    const gateway = mockGateway();
    const gatewayOrder = await gateway.createOrder({ amountPaise: order.amountPaise, receipt: `order-${order.id}` });
    const [payment] = await db
      .insert(payments)
      .values({
        purpose: 'SERVICE_ORDER',
        orderId: order.id,
        amountPaise: order.amountPaise,
        razorpayOrderId: gatewayOrder.gatewayOrderId,
      })
      .returning();
    const { gatewayPaymentId } = await gateway.simulateCapture(gatewayOrder.gatewayOrderId);

    const eventId = `evt_test_${payment!.id}_captured`;
    createdWebhookEventIds.push(eventId);
    const res = await POST(
      signedRequest({
        id: eventId,
        event: 'payment.captured',
        payload: { payment: { entity: { id: gatewayPaymentId, order_id: gatewayOrder.gatewayOrderId } } },
      })
    );
    expect(res.status).toBe(200);

    const [orderRow] = await db.select().from(orders).where(eq(orders.id, order.id));
    // Payment capture no longer stops at PAID — it runs straight into
    // ONBOARDING and creates the order's CRM contact in the same call
    // (docs/ARCHITECTURE.md §8, src/lib/payments/order-webhooks.ts).
    expect(orderRow?.stage).toBe('ONBOARDING');

    const [contactRow] = await db.select().from(crmContacts).where(eq(crmContacts.email, buyerUser.email));
    expect(contactRow).toBeDefined();
    expect(contactRow?.stage).toBe('ONBOARDING');

    const [entryRow] = await db.select().from(commissionEntries).where(eq(commissionEntries.id, entry.id));
    expect(entryRow?.status).toBe('APPROVED');
  });
});

describe('Razorpay webhook: refund.processed', () => {
  it('reverses commission proportionally, reading the cumulative refund from the gateway', async () => {
    const { user: buyerUser } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(buyerUser.id);
    const { user: refUser, affiliate: referrer } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(refUser.id);

    const order = await createTestOrder({ userId: buyerUser.id, amountPaise: 1000000 });
    createdOrderIds.push(order.id);
    await recordConversion({ orderId: order.id, affiliateId: referrer.id }); // 10% default -> 100000 paise commission

    const gateway = mockGateway();
    const gatewayOrder = await gateway.createOrder({ amountPaise: order.amountPaise, receipt: `order-${order.id}` });
    const [payment] = await db
      .insert(payments)
      .values({
        purpose: 'SERVICE_ORDER',
        orderId: order.id,
        amountPaise: order.amountPaise,
        razorpayOrderId: gatewayOrder.gatewayOrderId,
      })
      .returning();
    const { gatewayPaymentId } = await gateway.simulateCapture(gatewayOrder.gatewayOrderId);
    await db
      .update(payments)
      .set({ razorpayPaymentId: gatewayPaymentId, status: 'CAPTURED' })
      .where(eq(payments.id, payment!.id));

    // Razorpay reports a refund as an updated cumulative amount_refunded on
    // the SAME payment id — simulate a 50% refund the same way.
    const cumulativeRefundPaise = 500000; // 50%
    await gateway.simulateRefund(gatewayPaymentId, cumulativeRefundPaise);

    const eventId = `evt_test_${payment!.id}_refund`;
    createdWebhookEventIds.push(eventId);

    const res = await POST(
      signedRequest({
        id: eventId,
        event: 'refund.processed',
        payload: { payment: { entity: { id: gatewayPaymentId } } },
      })
    );
    expect(res.status).toBe(200);

    const [conversion] = await db
      .select()
      .from(affiliateConversions)
      .where(eq(affiliateConversions.orderId, order.id));
    const reversals = await db
      .select()
      .from(commissionEntries)
      .where(eq(commissionEntries.conversionId, conversion!.id));
    const reversal = reversals.find((r) => r.type === 'REVERSAL');
    expect(reversal?.amountPaise).toBe(-50000); // 50% of the 100000 commission
  });
});
