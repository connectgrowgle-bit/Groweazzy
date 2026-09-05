import { describe, it, expect, vi, afterEach } from 'vitest';
import { RazorpayGateway } from '@/lib/payments/razorpay-gateway';

// Tests against a CONTRACT FAKE (a mocked fetch returning the request/
// response shapes Razorpay's published API reference documents) — not a
// real Razorpay account, which this environment has no network path to.
// See the caveat at the top of src/lib/payments/razorpay-gateway.ts:
// Phase 13 is what actually verifies these shapes against a live account.
describe('RazorpayGateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createOrder sends amount/currency/receipt and Basic auth, and parses the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'order_ABC123', amount: 250000, currency: 'INR' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new RazorpayGateway('rzp_test_key', 'rzp_test_secret');
    const result = await gateway.createOrder({ amountPaise: 250000, receipt: 'affiliate-fee-123' });

    expect(result).toEqual({ gatewayOrderId: 'order_ABC123', amountPaise: 250000, currency: 'INR' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe(`Basic ${Buffer.from('rzp_test_key:rzp_test_secret').toString('base64')}`);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ amount: 250000, currency: 'INR', receipt: 'affiliate-fee-123' });
  });

  it('throws with the response body on a non-ok createOrder response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => '{"error":"bad key"}' })
    );
    const gateway = new RazorpayGateway('bad', 'bad');
    await expect(gateway.createOrder({ amountPaise: 100, receipt: 'x' })).rejects.toThrow(/401/);
  });

  it('fetchPaymentStatus maps a captured payment correctly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'pay_XYZ', status: 'captured', amount: 250000, amount_refunded: 0 }),
      })
    );
    const gateway = new RazorpayGateway('key', 'secret');
    const result = await gateway.fetchPaymentStatus('pay_XYZ');
    expect(result).toEqual({ status: 'captured', amountPaise: 250000, amountRefundedPaise: 0 });
  });

  it('fetchPaymentStatus reports a partial refund via amount_refunded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'pay_XYZ', status: 'captured', amount: 250000, amount_refunded: 62500 }),
      })
    );
    const gateway = new RazorpayGateway('key', 'secret');
    const result = await gateway.fetchPaymentStatus('pay_XYZ');
    expect(result.amountRefundedPaise).toBe(62500);
  });
});
