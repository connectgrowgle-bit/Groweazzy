import { describe, it, expect } from 'vitest';
import { signAttributionCookie, verifyAttributionCookie } from '@/lib/attribution/cookie';

describe('attribution cookie signing', () => {
  it('round-trips a cookieId through sign/verify', () => {
    const signed = signAttributionCookie('abc-123');
    expect(verifyAttributionCookie(signed)).toBe('abc-123');
  });

  it('rejects a tampered cookieId (signature no longer matches)', () => {
    const signed = signAttributionCookie('abc-123');
    const tampered = signed.replace('abc-123', 'xyz-999');
    expect(verifyAttributionCookie(tampered)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const signed = signAttributionCookie('abc-123');
    const [value] = signed.split('.');
    expect(verifyAttributionCookie(`${value}.0000000000000000000000000000000000000000000000000000000000000000`)).toBeNull();
  });

  it('rejects a value with no signature at all', () => {
    expect(verifyAttributionCookie('just-a-plain-value-no-dot-separator-oops')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(verifyAttributionCookie('')).toBeNull();
  });
});
