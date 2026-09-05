import { randomUUID } from 'node:crypto';
import type { CreateOrderParams, CreateOrderResult, PaymentGateway, PaymentStatusResult } from './gateway';

type MockOrder = { amountPaise: number; currency: string };
type MockPayment = { orderId: string; amountPaise: number; amountRefundedPaise: number; status: PaymentStatusResult['status'] };

// In-memory only — fine for a mock used in dev/tests within a single
// process (docs/ARCHITECTURE.md §3's PaymentGateway interface note). Real
// checkout doesn't exist until Phase 6, so `simulateCapture`/`simulateFailure`
// stand in for "the client completed Razorpay Checkout and we got a
// payment id" without an actual browser flow.
export class MockPaymentGateway implements PaymentGateway {
  private orders = new Map<string, MockOrder>();
  private payments = new Map<string, MockPayment>();

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const gatewayOrderId = `mock_order_${randomUUID()}`;
    const currency = params.currency ?? 'INR';
    this.orders.set(gatewayOrderId, { amountPaise: params.amountPaise, currency });
    return { gatewayOrderId, amountPaise: params.amountPaise, currency };
  }

  async fetchPaymentStatus(gatewayPaymentId: string): Promise<PaymentStatusResult> {
    const payment = this.payments.get(gatewayPaymentId);
    if (!payment) {
      throw new Error(`No such mock payment: ${gatewayPaymentId}`);
    }
    return {
      status: payment.status,
      amountPaise: payment.amountPaise,
      amountRefundedPaise: payment.amountRefundedPaise,
    };
  }

  // Test/dev-only: stands in for a completed Razorpay Checkout. Returns the
  // gatewayPaymentId the caller would otherwise get from the client
  // callback or a webhook — which the caller must then verify via
  // fetchPaymentStatus() rather than trust directly (rule 6).
  async simulateCapture(gatewayOrderId: string): Promise<{ gatewayPaymentId: string }> {
    const order = this.orders.get(gatewayOrderId);
    if (!order) throw new Error(`No such mock order: ${gatewayOrderId}`);
    const gatewayPaymentId = `mock_pay_${randomUUID()}`;
    this.payments.set(gatewayPaymentId, {
      orderId: gatewayOrderId,
      amountPaise: order.amountPaise,
      amountRefundedPaise: 0,
      status: 'captured',
    });
    return { gatewayPaymentId };
  }

  async simulateFailure(gatewayOrderId: string): Promise<{ gatewayPaymentId: string }> {
    const order = this.orders.get(gatewayOrderId);
    if (!order) throw new Error(`No such mock order: ${gatewayOrderId}`);
    const gatewayPaymentId = `mock_pay_${randomUUID()}`;
    this.payments.set(gatewayPaymentId, {
      orderId: gatewayOrderId,
      amountPaise: order.amountPaise,
      amountRefundedPaise: 0,
      status: 'failed',
    });
    return { gatewayPaymentId };
  }
}
