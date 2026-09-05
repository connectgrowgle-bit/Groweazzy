// The interface every payment adapter implements. Phase 3 ships only
// MockPaymentGateway (below); the real Razorpay adapter (Phase 5) implements
// the same interface, so nothing above this line changes when it lands
// (docs/ARCHITECTURE.md §5).
//
// Deliberately small: an order is created server-side before any client
// checkout opens (docs/ARCHITECTURE.md §7 — a payment without an order_id
// can't be captured), and status is always confirmed by asking the gateway
// directly (fetchPaymentStatus), never taken on the frontend's word (rule 6).

export type GatewayPaymentStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';

export type CreateOrderParams = {
  amountPaise: number;
  currency?: string; // defaults to INR
  receipt: string; // our own reference, e.g. `affiliate-fee-<affiliateId>`
  notes?: Record<string, string>;
};

export type CreateOrderResult = {
  gatewayOrderId: string;
  amountPaise: number;
  currency: string;
};

export type PaymentStatusResult = {
  status: GatewayPaymentStatus;
  amountPaise: number;
  amountRefundedPaise: number;
};

export interface PaymentGateway {
  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;

  // Server-to-server status fetch by the gateway's own payment id — the
  // only thing allowed to mark a payment CAPTURED (rule 6). A real adapter
  // calls the provider's API; the mock looks up its own in-memory ledger.
  fetchPaymentStatus(gatewayPaymentId: string): Promise<PaymentStatusResult>;
}
