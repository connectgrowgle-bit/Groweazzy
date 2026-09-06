import { describe, it, expect } from 'vitest';
import { encryptMfaSecret, decryptMfaSecret } from '@/lib/crypto/mfa-secret';
import { decryptPii } from '@/lib/crypto/pii';

describe('MFA secret encryption', () => {
  it('round-trips a value through encrypt/decrypt', () => {
    const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP');
    expect(encrypted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptMfaSecret(encrypted)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces a different ciphertext each time (random IV) but decrypts to the same plaintext', () => {
    const a = encryptMfaSecret('same-secret');
    const b = encryptMfaSecret('same-secret');
    expect(a).not.toBe(b);
    expect(decryptMfaSecret(a)).toBe('same-secret');
    expect(decryptMfaSecret(b)).toBe('same-secret');
  });

  it('rejects a tampered ciphertext (GCM auth tag check fails)', () => {
    const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP');
    const parts = encrypted.split('.');
    const tamperedCiphertext = parts[3]!.slice(0, -1) + (parts[3]!.endsWith('0') ? '1' : '0');
    const tampered = [parts[0], parts[1], parts[2], tamperedCiphertext].join('.');
    expect(() => decryptMfaSecret(tampered)).toThrow();
  });

  it('rejects a malformed value', () => {
    expect(() => decryptMfaSecret('not-a-real-encrypted-value')).toThrow();
  });

  // The actual point of deriving a separate subkey (src/lib/crypto/mfa-secret.ts's
  // own comment): a value encrypted for one purpose must not be decryptable
  // by the other purpose's function, even though both use the exact same
  // master key and the exact same "v1.iv.tag.ciphertext" wire format —
  // proven here by feeding an MFA-secret ciphertext to decryptPii and
  // confirming the GCM auth tag check fails under PII's derived key.
  it('is not decryptable by encryptPii/decryptPii — independently derived subkeys, not just separate functions', () => {
    const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP');
    expect(() => decryptPii(encrypted)).toThrow();
  });
});
