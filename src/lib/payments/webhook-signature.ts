import { createHmac, timingSafeEqual } from 'node:crypto';

// Razorpay signs each webhook delivery with HMAC-SHA256 over the EXACT raw
// request body, using the webhook secret configured in their dashboard —
// a separate value from the API key secret (docs/ARCHITECTURE.md rule 8;
// src/lib/env.ts refuses to boot if they're equal). The signature arrives
// in the `X-Razorpay-Signature` header.
//
// This MUST run against the untouched raw body bytes (rule 7) — parsing to
// JSON and re-serializing before verifying does not reproduce the same
// digest, since key order, whitespace, and number formatting aren't
// guaranteed to round-trip identically.
export function verifyRazorpayWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

  const providedBuf = Buffer.from(signatureHeader, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (providedBuf.length === 0 || providedBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(providedBuf, expectedBuf);
}
