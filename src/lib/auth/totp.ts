import { createHmac, randomBytes } from 'node:crypto';

// RFC 6238 TOTP over RFC 4226 HOTP, implemented directly against
// node:crypto rather than pulling in a dependency — the algorithm is small
// and fixed (it can never need an update once RFC 6238-compliant), and
// every authenticator app (Google Authenticator, Authy, 1Password, ...)
// interoperates against the exact same fixed parameters this uses:
// HMAC-SHA1, 6 digits, a 30-second time step. SHA-1 here is not a weakened
// choice — it's the universal interop default for TOTP; the algorithm's
// security doesn't rest on SHA-1's collision resistance the way a
// signature scheme would, only on HMAC's keyed-PRF property, which SHA-1
// still provides.
const TIME_STEP_SECONDS = 30;
const CODE_DIGITS = 6;
// ±1 step tolerance either side of "now" — absorbs ordinary clock drift
// between this server and the user's phone without materially widening
// the brute-force window (3 valid 30s windows instead of 1, out of
// 1,000,000 possible codes — src/app/api/auth/mfa/verify/route.ts's own
// rate limit is what actually keeps that infeasible).
const CLOCK_DRIFT_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// RFC 4648 base32, no padding — the form every authenticator app expects
// for the `secret` parameter of an otpauth:// URI, and for manual entry
// when a user can't scan a QR code.
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(encoded: string): Buffer {
  const cleaned = encoded.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 160 bits (20 bytes) — RFC 4226's own recommended HOTP secret length, and
// what every authenticator app assumes when scanning a QR code.
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(keyBytes: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  // Counter is a plain JS number here (always small — see timeStepFor
  // below, floor(unix seconds / 30) doesn't approach Number.MAX_SAFE_INTEGER
  // for a very long time), so writeUInt32BE on the low 4 bytes is enough;
  // the high 4 bytes of the 8-byte HOTP counter stay zero, per spec.
  counterBuffer.writeUInt32BE(counter, 4);

  const hmac = createHmac('sha1', keyBytes).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const truncated =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return (truncated % 10 ** CODE_DIGITS).toString().padStart(CODE_DIGITS, '0');
}

function timeStepFor(date: Date): number {
  return Math.floor(date.getTime() / 1000 / TIME_STEP_SECONDS);
}

export function generateTotpCode(secretBase32: string, at: Date = new Date()): string {
  return hotp(base32Decode(secretBase32), timeStepFor(at));
}

// Returns the specific time step the code matched (for replay-protection —
// src/db/schema/auth.ts's mfa_used_codes table keys on exactly this), or
// null if the code doesn't match any step within the drift window. Callers
// MUST record the returned timeStep as used before trusting this result —
// see src/app/api/auth/mfa/verify/route.ts.
export function verifyTotpCode(secretBase32: string, code: string, at: Date = new Date()): number | null {
  if (!/^\d{6}$/.test(code)) return null;

  const keyBytes = base32Decode(secretBase32);
  const currentStep = timeStepFor(at);

  for (let drift = -CLOCK_DRIFT_STEPS; drift <= CLOCK_DRIFT_STEPS; drift++) {
    const step = currentStep + drift;
    if (hotp(keyBytes, step) === code) return step;
  }
  return null;
}

// otpauth://totp/{issuer}:{account}?secret=...&issuer=...&digits=6&period=30
// — the URI form authenticator apps consume directly from a QR code. This
// build renders it as plain text (and the raw secret alongside it) rather
// than an actual QR image — no QR-generation library is a dependency of
// this project, and every authenticator app supports typing the secret in
// manually as a fallback for exactly this "can't scan a code" case, so
// text-only enrollment is a complete, working flow, not a placeholder.
export function buildOtpauthUrl(params: { secretBase32: string; accountEmail: string; issuer: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountEmail}`);
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    digits: String(CODE_DIGITS),
    period: String(TIME_STEP_SECONDS),
    algorithm: 'SHA1',
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
