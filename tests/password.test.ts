import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, needsRehash } from '@/lib/auth/password';

describe('password hashing', () => {
  it('hashes with argon2id and verifies the same plaintext', async () => {
    const hash = await hashPassword('a-reasonably-strong-password');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'a-reasonably-strong-password')).toBe(true);
  });

  it('rejects the wrong plaintext', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('does not throw on a malformed/foreign hash — treats it as a failed verification', async () => {
    await expect(verifyPassword('not-a-real-hash', 'anything')).resolves.toBe(false);
  });

  it('does not flag a hash made with current parameters for rehash', async () => {
    const hash = await hashPassword('some-password');
    expect(needsRehash(hash)).toBe(false);
  });
});
