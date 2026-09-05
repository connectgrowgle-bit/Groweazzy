import { getEnv } from '@/lib/env';
import type { PaymentGateway } from './gateway';
import { MockPaymentGateway } from './mock-gateway';

export type { PaymentGateway, CreateOrderParams, CreateOrderResult, PaymentStatusResult } from './gateway';
export { MockPaymentGateway } from './mock-gateway';

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

  // Phase 5 implements a RazorpayGateway class satisfying the same
  // PaymentGateway interface — nothing above this function changes then.
  throw new Error(`PAYMENT_PROVIDER=${env.PAYMENT_PROVIDER} has no gateway implementation yet (lands in Phase 5)`);
}
