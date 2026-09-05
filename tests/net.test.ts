import { describe, it, expect } from 'vitest';
import { getClientIp } from '@/lib/net';

// TRUSTED_PROXY_HEADER is set to 'x-forwarded-for' for the whole test run
// (tests/test-env-constants.ts) — deliberately, so tests exercise the same
// trusted-proxy-configured code path a real deployment would use rather
// than the (also correct, but less interesting) "nothing configured,
// always null" case, which is a one-line early return in the source.
describe('getClientIp (src/lib/net.ts)', () => {
  it('reads the configured header when present', () => {
    const request = new Request('http://localhost/', { headers: { 'x-forwarded-for': '203.0.113.5' } });
    expect(getClientIp(request)).toBe('203.0.113.5');
  });

  it('takes the FIRST hop of a comma-separated chain', () => {
    const request = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2' },
    });
    expect(getClientIp(request)).toBe('203.0.113.5');
  });

  it('returns null when the header is absent', () => {
    const request = new Request('http://localhost/');
    expect(getClientIp(request)).toBeNull();
  });

  it('returns null for an empty header value', () => {
    const request = new Request('http://localhost/', { headers: { 'x-forwarded-for': '' } });
    expect(getClientIp(request)).toBeNull();
  });
});
