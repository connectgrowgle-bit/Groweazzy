import { describe, it, expect } from 'vitest';
import { encryptPii, decryptPii, fingerprintPii, last4 } from '@/lib/crypto/pii';

describe('PII encryption', () => {
  it('round-trips a value through encrypt/decrypt', () => {
    const encrypted = encryptPii('ABCDE1234F');
    expect(encrypted).not.toContain('ABCDE1234F');
    expect(decryptPii(encrypted)).toBe('ABCDE1234F');
  });

  it('produces a different ciphertext each time (random IV) but decrypts to the same plaintext', () => {
    const a = encryptPii('same-value');
    const b = encryptPii('same-value');
    expect(a).not.toBe(b);
    expect(decryptPii(a)).toBe('same-value');
    expect(decryptPii(b)).toBe('same-value');
  });

  it('rejects a tampered ciphertext (GCM auth tag check fails)', () => {
    const encrypted = encryptPii('ABCDE1234F');
    const parts = encrypted.split('.');
    // Flip a character in the ciphertext segment.
    const tamperedCiphertext = parts[3]!.slice(0, -1) + (parts[3]!.endsWith('0') ? '1' : '0');
    const tampered = [parts[0], parts[1], parts[2], tamperedCiphertext].join('.');
    expect(() => decryptPii(tampered)).toThrow();
  });

  it('rejects a malformed value', () => {
    expect(() => decryptPii('not-a-real-encrypted-value')).toThrow();
  });

  it('fingerprints the same PAN identically regardless of case or surrounding whitespace', () => {
    const a = fingerprintPii('ABCDE1234F');
    const b = fingerprintPii(' abcde1234f ');
    expect(a).toBe(b);
  });

  it('fingerprints different values differently', () => {
    expect(fingerprintPii('ABCDE1234F')).not.toBe(fingerprintPii('ZYXWV9876G'));
  });

  it('last4 takes the final 4 characters after trimming', () => {
    expect(last4(' 1234567890 ')).toBe('7890');
    expect(last4('ABCDE1234F')).toBe('234F');
  });
});
