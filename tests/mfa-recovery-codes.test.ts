import { describe, it, expect } from 'vitest';
import {
  formatRecoveryCodeForDisplay,
  generateRecoveryCodes,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  normalizeRecoveryCodeInput,
  verifyRecoveryCode,
} from '@/lib/auth/mfa-recovery-codes';

describe('generateRecoveryCodes', () => {
  it('generates 10 unique 8-digit raw codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) expect(code).toMatch(/^\d{8}$/);
    expect(new Set(codes).size).toBe(10);
  });
});

describe('formatRecoveryCodeForDisplay / normalizeRecoveryCodeInput', () => {
  it('formats as XXXX-XXXX and normalizes back to the raw form regardless of how it was typed', () => {
    const raw = '12345678';
    const displayed = formatRecoveryCodeForDisplay(raw);
    expect(displayed).toBe('1234-5678');

    expect(normalizeRecoveryCodeInput(displayed)).toBe(raw);
    expect(normalizeRecoveryCodeInput('1234 5678')).toBe(raw);
    expect(normalizeRecoveryCodeInput('12345678')).toBe(raw);
    expect(normalizeRecoveryCodeInput(' 1234-5678 ')).toBe(raw);
  });
});

describe('looksLikeRecoveryCode', () => {
  it('accepts exactly 8 digits and nothing else', () => {
    expect(looksLikeRecoveryCode('12345678')).toBe(true);
    expect(looksLikeRecoveryCode('1234567')).toBe(false);
    expect(looksLikeRecoveryCode('123456789')).toBe(false);
    expect(looksLikeRecoveryCode('')).toBe(false);
  });
});

describe('hashRecoveryCode / verifyRecoveryCode', () => {
  it('hashes the raw form and verifies against it — independent of display formatting, which never touches the hash', async () => {
    const raw = '87654321';
    const hash = await hashRecoveryCode(raw);
    expect(hash).not.toBe(raw);
    expect(await verifyRecoveryCode(hash, raw)).toBe(true);
    expect(await verifyRecoveryCode(hash, normalizeRecoveryCodeInput(formatRecoveryCodeForDisplay(raw)))).toBe(true);
    expect(await verifyRecoveryCode(hash, '00000000')).toBe(false);
  });
});
