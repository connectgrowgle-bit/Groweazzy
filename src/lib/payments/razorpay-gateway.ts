import type { CreateOrderParams, CreateOrderResult, GatewayPaymentStatus, PaymentGateway, PaymentStatusResult } from './gateway';

// Talks to Razorpay's REST API directly (Basic Auth: key_id:key_secret,
// base64) rather than through their Node SDK — the two calls this needs
// are simple enough that a dependency isn't worth it, and it keeps this
// adapter's surface identical to what PaymentGateway declares.
//
// NOT verified against a real Razorpay account in this build (no network
// access to api.razorpay.com from this environment) — tested here only
// against a contract fake (tests/razorpay-gateway.test.ts intercepts
// global fetch with the request/response shapes Razorpay's published API
// reference documents). Phase 13 ("real gateway verification... on a
// machine that can reach the provider") is what actually confirms this
// against the live API; treat the exact response field names below as
// best-effort until that phase runs.
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

type RazorpayOrderResponse = {
  id: string;
  amount: number;
  currency: string;
};

type RazorpayPaymentResponse = {
  id: string;
  status: 'created' | 'authorized' | 'captured' | 'failed' | 'refunded';
  amount: number;
  amount_refunded: number;
};

const STATUS_MAP: Record<RazorpayPaymentResponse['status'], GatewayPaymentStatus> = {
  created: 'created',
  authorized: 'authorized',
  captured: 'captured',
  failed: 'failed',
  refunded: 'refunded',
};

export class RazorpayGateway implements PaymentGateway {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string
  ) {}

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const res = await fetch(`${RAZORPAY_API_BASE}/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: this.authHeader(),
      },
      body: JSON.stringify({
        amount: params.amountPaise, // Razorpay's "amount" is already in paise
        currency: params.currency ?? 'INR',
        receipt: params.receipt,
        notes: params.notes,
      }),
    });

    if (!res.ok) {
      throw new Error(`Razorpay createOrder failed (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as RazorpayOrderResponse;
    return { gatewayOrderId: data.id, amountPaise: data.amount, currency: data.currency };
  }

  async fetchPaymentStatus(gatewayPaymentId: string): Promise<PaymentStatusResult> {
    const res = await fetch(`${RAZORPAY_API_BASE}/payments/${gatewayPaymentId}`, {
      headers: { authorization: this.authHeader() },
    });

    if (!res.ok) {
      throw new Error(`Razorpay fetchPaymentStatus failed (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as RazorpayPaymentResponse;
    return {
      status: STATUS_MAP[data.status] ?? 'failed',
      amountPaise: data.amount,
      amountRefundedPaise: data.amount_refunded ?? 0,
    };
  }
}
