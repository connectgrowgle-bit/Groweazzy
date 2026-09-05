import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { verifyRazorpayWebhookSignature } from '@/lib/payments/webhook-signature';

const SECRET = 'a-test-webhook-secret';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyRazorpayWebhookSignature', () => {
  it('accepts a correctly signed body', () => {
    const body = '{"event":"payment.captured"}';
    expect(verifyRazorpayWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a body that was modified after signing', () => {
    const body = '{"event":"payment.captured"}';
    const signature = sign(body);
    const tamperedBody = '{"event":"payment.captured","amount":999999999}';
    expect(verifyRazorpayWebhookSignature(tamperedBody, signature, SECRET)).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const body = '{"event":"payment.captured"}';
    expect(verifyRazorpayWebhookSignature(body, sign(body, 'wrong-secret'), SECRET)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(verifyRazorpayWebhookSignature('{}', null, SECRET)).toBe(false);
  });

  it('rejects a malformed (non-hex, wrong-length) signature without throwing', () => {
    expect(verifyRazorpayWebhookSignature('{}', 'not-hex-and-wrong-length', SECRET)).toBe(false);
  });
});
