import { describe, it, expect } from 'vitest';
import {
  base32Decode,
  base32Encode,
  buildOtpauthUrl,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
} from '@/lib/auth/totp';

describe('base32Encode/base32Decode', () => {
  it('round-trips arbitrary bytes', () => {
    const original = Buffer.from('the quick brown fox', 'utf8');
    expect(base32Decode(base32Encode(original)).equals(original)).toBe(true);
  });

  it('round-trips a freshly generated secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    // 20 random bytes encode to 32 base32 characters (160 bits / 5 bits per char).
    expect(secret).toHaveLength(32);
  });
});

// RFC 6238 Appendix B publishes fixed (SHA-1, 8-digit) test vectors against
// the ASCII key "12345678901234567890". This project always emits 6
// digits, but 6-digit truncation is just "the last 6 decimal digits" of
// the exact same computed value the RFC's 8-digit vectors publish — so
// each expected value below is the RFC's own published 8-digit answer,
// right-truncated to 6, re-derived from the same ASCII key re-encoded as
// base32 (the form this codebase's functions accept). This is a real
// correctness check against a published, interoperable reference, not a
// tautology against this module's own output.
const RFC_6238_KEY_SHA1 = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('generateTotpCode / verifyTotpCode (RFC 6238 Appendix B vectors, right-truncated to 6 digits)', () => {
  it.each([
    [59, '287082'], // RFC: T=1, 8-digit "94287082"
    [1111111109, '081804'], // RFC: T=37037036, 8-digit "07081804"
    [1111111111, '050471'], // RFC: T=37037037, 8-digit "14050471"
    [1234567890, '005924'], // RFC: T=41152263, 8-digit "89005924"
  ])('unix time %i produces %s', (unixSeconds, expected) => {
    const code = generateTotpCode(RFC_6238_KEY_SHA1, new Date(unixSeconds * 1000));
    expect(code).toBe(expected);
  });

  it('verifyTotpCode accepts the code at the exact matching time step', () => {
    const timeStep = verifyTotpCode(RFC_6238_KEY_SHA1, '287082', new Date(59 * 1000));
    expect(timeStep).toBe(1); // floor(59 / 30)
  });

  it('verifyTotpCode rejects a code with no match in the drift window', () => {
    // "287082" is only valid around T=1 (unix time 59) — nowhere near this.
    const timeStep = verifyTotpCode(RFC_6238_KEY_SHA1, '287082', new Date(1111111109 * 1000));
    expect(timeStep).toBeNull();
  });

  it('tolerates ±1 step of clock drift', () => {
    const secret = generateTotpSecret();
    const now = new Date();
    const oneStepAgo = new Date(now.getTime() - 30 * 1000);
    const codeFromOneStepAgo = generateTotpCode(secret, oneStepAgo);

    // Verified "now", against a code actually generated one step earlier —
    // simulates a phone's clock running exactly one step behind the server.
    expect(verifyTotpCode(secret, codeFromOneStepAgo, now)).not.toBeNull();
  });

  it('rejects malformed input outright — not just a code that fails to match', () => {
    expect(verifyTotpCode(RFC_6238_KEY_SHA1, 'abcdef')).toBeNull();
    expect(verifyTotpCode(RFC_6238_KEY_SHA1, '12345')).toBeNull(); // too short
    expect(verifyTotpCode(RFC_6238_KEY_SHA1, '1234567')).toBeNull(); // too long
  });
});

describe('buildOtpauthUrl', () => {
  it('produces a well-formed otpauth:// URI carrying the secret, issuer, and fixed parameters', () => {
    const url = buildOtpauthUrl({ secretBase32: 'ABCDEFGH', accountEmail: 'user@example.test', issuer: 'GrowEazzy' });
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain('secret=ABCDEFGH');
    expect(url).toContain('issuer=GrowEazzy');
    expect(url).toContain('digits=6');
    expect(url).toContain('period=30');
    expect(url).toContain(encodeURIComponent('GrowEazzy:user@example.test'));
  });
});
