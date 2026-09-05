import { getEnv } from '@/lib/env';
import type { PaymentGateway } from './gateway';
import { MockPaymentGateway } from './mock-gateway';
import { RazorpayGateway } from './razorpay-gateway';

export type { PaymentGateway, CreateOrderParams, CreateOrderResult, PaymentStatusResult } from './gateway';
export { MockPaymentGateway } from './mock-gateway';
export { RazorpayGateway } from './razorpay-gateway';

let singleton: PaymentGateway | null = null;

// Module-level singleton so MockPaymentGateway's in-memory order/payment
// ledger is shared across requests within a process — a fresh instance per
// call would make simulateCapture() unable to find the order it just made.
export function getPaymentGateway(): PaymentGateway {
  if (singleton) return singleton;

  const env = getEnv();
  if (env.PAYMENT_PROVIDER === 'mock') {
    singleton = new MockPaymentGateway();
    return singleton;
  }

  // env.ts's superRefine already guarantees RAZORPAY_KEY_ID/SECRET are set
  // and cross-checked against PAYMENT_MODE whenever PAYMENT_PROVIDER is
  // 'razorpay' — the non-null assertions here are backed by that, not a
  // fresh assumption made in this file.
  singleton = new RazorpayGateway(env.RAZORPAY_KEY_ID!, env.RAZORPAY_KEY_SECRET!);
  return singleton;
}
