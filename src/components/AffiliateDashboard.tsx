'use client';

import { useEffect, useState } from 'react';

type AffiliateMe = {
  id: string;
  status: string;
  referralCode: string;
  bankAccountLast4: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  terminatedAt: string | null;
};

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.formErrors?.[0] ?? body.error ?? `Request failed (${res.status})`);
  return body;
}

export function AffiliateDashboard() {
  const [affiliate, setAffiliate] = useState<AffiliateMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/affiliate/me');
      if (res.status === 404) {
        setAffiliate(null);
      } else {
        setAffiliate(await jsonOrThrow(res));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Fetch-on-mount from a client component — the new
    // react-hooks/set-state-in-effect rule flags any effect whose callback
    // transitively calls setState (even inside an async function, after an
    // await) as a suspected non-local-derived-state smell. That's not what
    // this is: there's no external subscription or props-derived value to
    // model, just "load this dashboard's own data once on mount," which is
    // exactly what an effect is for. Suppressed rather than restructured
    // into a data-fetching library for one component.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleRegister() {
    setBusy(true);
    setError(null);
    try {
      await jsonOrThrow(await fetch('/api/affiliate/register', { method: 'POST' }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function handleKycSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    try {
      await jsonOrThrow(
        await fetch('/api/affiliate/kyc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            pan: formData.get('pan'),
            bankAccountNumber: formData.get('bankAccountNumber'),
            bankIfsc: formData.get('bankIfsc'),
          }),
        })
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function handlePayFee() {
    setBusy(true);
    setError(null);
    try {
      const { paymentId, gatewayOrderId } = await jsonOrThrow(
        await fetch('/api/affiliate/fee/initiate', { method: 'POST' })
      );
      // Dev-only: stands in for completing Razorpay Checkout (Phase 6/5
      // land the real flow). Gated server-side to PAYMENT_PROVIDER=mock and
      // non-production — see src/app/api/dev/mock-payment/route.ts.
      const { gatewayPaymentId } = await jsonOrThrow(
        await fetch('/api/dev/mock-payment', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ gatewayOrderId, outcome: 'captured' }),
        })
      );
      await jsonOrThrow(
        await fetch('/api/affiliate/fee/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ paymentId, gatewayPaymentId }),
        })
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="space-y-6">
      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {!affiliate && (
        <div>
          <p className="text-gray-600">You&apos;re not registered as an affiliate yet.</p>
          <button
            onClick={handleRegister}
            disabled={busy}
            className="mt-4 rounded-md bg-brand px-6 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Registering…' : 'Register as an affiliate'}
          </button>
        </div>
      )}

      {affiliate && (
        <div>
          <div className="rounded-md border border-gray-200 p-4">
            <div className="text-sm text-gray-500">Status</div>
            <div className="text-lg font-semibold text-gray-900">{affiliate.status.replace('_', ' ')}</div>
            <div className="mt-2 text-sm text-gray-500">Referral code</div>
            <div className="font-mono text-gray-900">{affiliate.referralCode}</div>
          </div>

          {(affiliate.status === 'KYC_PENDING' || affiliate.status === 'KYC_REJECTED') && (
            <form onSubmit={handleKycSubmit} className="mt-6 space-y-4">
              <h2 className="font-medium text-gray-900">Submit KYC</h2>
              {affiliate.status === 'KYC_REJECTED' && (
                <p className="text-sm text-amber-700">
                  Your previous submission was rejected. You can submit again below.
                </p>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700">PAN</label>
                <input name="pan" placeholder="ABCDE1234F" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 uppercase" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Bank account number</label>
                <input name="bankAccountNumber" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">IFSC</label>
                <input name="bankIfsc" placeholder="HDFC0001234" required className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 uppercase" />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-brand px-6 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Submitting…' : 'Submit KYC'}
              </button>
            </form>
          )}

          {affiliate.status === 'KYC_SUBMITTED' && (
            <p className="mt-6 text-gray-600">Your KYC is under review. We&apos;ll notify you once it&apos;s decided.</p>
          )}

          {affiliate.status === 'FEE_PENDING' && (
            <div className="mt-6">
              <p className="text-gray-600">KYC approved — pay the registration fee to activate your account.</p>
              <button
                onClick={handlePayFee}
                disabled={busy}
                className="mt-4 rounded-md bg-brand px-6 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Processing…' : 'Pay registration fee'}
              </button>
            </div>
          )}

          {affiliate.status === 'ACTIVE' && (
            <p className="mt-6 text-green-700">
              You&apos;re active! Share links like <code>/ai-content-avatar?ref={affiliate.referralCode}</code> to
              earn commission.
            </p>
          )}

          {affiliate.status === 'SUSPENDED' && (
            <p className="mt-6 text-amber-700">Your affiliate account is currently suspended.</p>
          )}

          {affiliate.status === 'TERMINATED' && (
            <p className="mt-6 text-red-700">Your affiliate account has been terminated.</p>
          )}
        </div>
      )}
    </div>
  );
}
