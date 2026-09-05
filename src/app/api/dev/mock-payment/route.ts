import { z } from 'zod';
import { getEnv } from '@/lib/env';
import { getPaymentGateway, MockPaymentGateway } from '@/lib/payments';

// Dev/test-only stand-in for "the client completed Razorpay Checkout".
// Hard-gated to PAYMENT_PROVIDER=mock and APP_ENV!=production — this must
// never be reachable in a real deployment, since it lets the caller
// fabricate a captured payment outcome. There is no real checkout UI until
// Phase 6; this is what lets the affiliate fee flow (and later, order
// checkout) be exercised end-to-end over real HTTP before then.
const schema = z.object({
  gatewayOrderId: z.string().min(1),
  outcome: z.enum(['captured', 'failed']).default('captured'),
});

export async function POST(request: Request) {
  const env = getEnv();
  if (env.PAYMENT_PROVIDER !== 'mock' || env.APP_ENV === 'production') {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const gateway = getPaymentGateway();
  if (!(gateway instanceof MockPaymentGateway)) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const result =
    parsed.data.outcome === 'captured'
      ? await gateway.simulateCapture(parsed.data.gatewayOrderId)
      : await gateway.simulateFailure(parsed.data.gatewayOrderId);

  return Response.json(result);
}
