import { describe, it, expect } from 'vitest';
import { safeInternalPath } from '@/lib/safe-redirect';

describe('safeInternalPath (src/lib/safe-redirect.ts)', () => {
  it('accepts a plain same-origin absolute path', () => {
    expect(safeInternalPath('/crm/123', '/account')).toBe('/crm/123');
    expect(safeInternalPath('/orders/abc?x=1', '/account')).toBe('/orders/abc?x=1');
  });

  it('falls back for undefined/null/empty', () => {
    expect(safeInternalPath(undefined, '/account')).toBe('/account');
    expect(safeInternalPath(null, '/account')).toBe('/account');
    expect(safeInternalPath('', '/account')).toBe('/account');
  });

  it('falls back for anything not starting with a single /', () => {
    expect(safeInternalPath('account', '/account')).toBe('/account');
    expect(safeInternalPath('https://evil.com', '/account')).toBe('/account');
    expect(safeInternalPath('javascript:alert(1)', '/account')).toBe('/account');
  });

  it('rejects protocol-relative URLs ("//host" resolves to a different origin)', () => {
    expect(safeInternalPath('//evil.com', '/account')).toBe('/account');
    expect(safeInternalPath('//evil.com/phish', '/account')).toBe('/account');
  });

  it('rejects the backslash variant browsers normalize to "//"', () => {
    expect(safeInternalPath('/\\evil.com', '/account')).toBe('/account');
  });
});
