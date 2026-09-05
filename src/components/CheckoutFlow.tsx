'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.formErrors?.[0] ?? body.error ?? `Request failed (${res.status})`);
  return body;
}

// "checkout → payment → verification → order" (docs/ARCHITECTURE.md §8).
// Real Razorpay Checkout.js (the customer-facing widget) is deferred
// alongside Phase 13's real-gateway verification — this sandbox has no
// network path to checkout.razorpay.com any more than it does to
// api.razorpay.com (see src/lib/payments/razorpay-gateway.ts's own
// caveat). Until then this drives the same PAYMENT_PROVIDER=mock
// dev-simulation endpoint the affiliate fee flow already uses
// (src/components/AffiliateDashboard.tsx, src/app/api/dev/mock-payment) —
// swapping this button for the real widget is a frontend-only change, none
// of the server-side checkout/confirm plumbing behind it moves.
export function CheckoutFlow({ planId }: { planId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setBusy(true);
    setError(null);
    try {
      const { orderId, gatewayOrderId } = await jsonOrThrow(
        await fetch('/api/orders/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ planId }),
        })
      );
      const { gatewayPaymentId } = await jsonOrThrow(
        await fetch('/api/dev/mock-payment', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ gatewayOrderId, outcome: 'captured' }),
        })
      );
      await jsonOrThrow(
        await fetch(`/api/orders/${orderId}/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ gatewayPaymentId }),
        })
      );
      router.push(`/orders/${orderId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <button
        type="button"
        onClick={handlePay}
        disabled={busy}
        className="w-full rounded-md bg-brand px-6 py-3 font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Processing…' : 'Pay now'}
      </button>
    </div>
  );
}
