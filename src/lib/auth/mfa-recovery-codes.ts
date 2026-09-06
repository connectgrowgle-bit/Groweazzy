import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from './password';

const RECOVERY_CODE_COUNT = 10;

// Raw form is a plain 8-digit string — what's actually hashed and
// compared. `formatRecoveryCodeForDisplay` and `normalizeRecoveryCodeInput`
// are the only two places that ever add or remove the "XXXX-XXXX"
// separator, so hashing is never sensitive to whether a user typed the
// dash back in, copy-pasted it, or left it out — 10^8 combinations per
// code, comparable entropy to an 8-digit PIN, acceptable for a one-time,
// single-use fallback credential that's also rate-limited at the point of
// use (src/app/api/auth/mfa/verify/route.ts).
function generateOneRawCode(): string {
  return String(randomInt(0, 100000000)).padStart(8, '0');
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, generateOneRawCode);
}

export function formatRecoveryCodeForDisplay(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

// Strips whatever separators/whitespace a user typed or pasted back in —
// "1234-5678", "1234 5678", and "12345678" must all verify identically.
export function normalizeRecoveryCodeInput(input: string): string {
  return input.replace(/[^0-9]/g, '');
}

export function looksLikeRecoveryCode(normalized: string): boolean {
  return /^\d{8}$/.test(normalized);
}

// Recovery codes are bearer credentials exactly like a password
// (src/db/schema/auth.ts's own comment on mfa_recovery_codes) — hashed
// with the identical Argon2id parameters via the identical functions,
// rather than a second hashing scheme this codebase would have to keep in
// sync with password.ts's own ARGON2_OPTIONS by hand. Always called with
// the raw (undashed) form on both sides.
export const hashRecoveryCode = hashPassword;
export const verifyRecoveryCode = verifyPassword;
