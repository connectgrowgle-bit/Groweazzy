import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { getEnv } from '@/lib/env';

// PAN and bank account details are encrypted at rest with AES-256-GCM; only
// the last 4 characters are ever stored readable (docs/ARCHITECTURE.md §5).
// PII_ENCRYPTION_KEY is the single master secret (32 bytes, hex). Rather
// than use it directly for two different cryptographic purposes
// (encryption and HMAC fingerprinting), HKDF derives two independent
// subkeys from it — standard key-separation practice, and it means a bug
// in one operation can't leak key material useful against the other.
//
// HKDF here uses a fixed, empty salt and fixed `info` strings. That's
// deliberate: the derivation must be *deterministic* — the same master key
// must always produce the same subkeys, on every process, forever, or
// already-encrypted KYC data becomes unreadable. HKDF's random-salt mode is
// for deriving many independent keys from a high-entropy input in a
// randomized protocol; this is the opposite case; a fixed salt is correct.
//
// PII_ENCRYPTION_KEY is NOT rotatable in this build (docs/ARCHITECTURE.md
// §15) — there is no re-encryption tooling yet. Rotating it makes every
// existing encrypted value permanently undecryptable.

const ENC_KEY_INFO = Buffer.from('groweazzy-pii-encryption-v1', 'utf8');
const HMAC_KEY_INFO = Buffer.from('groweazzy-pii-fingerprint-v1', 'utf8');
const EMPTY_SALT = Buffer.alloc(0);

function deriveKey(info: Buffer): Buffer {
  const env = getEnv();
  const masterKey = Buffer.from(env.PII_ENCRYPTION_KEY, 'hex');
  return Buffer.from(hkdfSync('sha256', masterKey, EMPTY_SALT, info, 32));
}

const ENCRYPTION_FORMAT_VERSION = 'v1';

// Format: "v1.<ivHex>.<authTagHex>.<ciphertextHex>". Versioned so a future
// change to the scheme (e.g. a KMS-backed key instead of an env var) can
// tell old and new ciphertexts apart during migration.
export function encryptPii(plaintext: string): string {
  const key = deriveKey(ENC_KEY_INFO);
  const iv = randomBytes(12); // 96-bit IV, the GCM-recommended size
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [ENCRYPTION_FORMAT_VERSION, iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(
    '.'
  );
}

export function decryptPii(encrypted: string): string {
  const [version, ivHex, authTagHex, ciphertextHex] = encrypted.split('.');
  if (version !== ENCRYPTION_FORMAT_VERSION || !ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed or unrecognized encrypted PII value');
  }
  const key = deriveKey(ENC_KEY_INFO);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}

// A keyed HMAC over the *normalized* value (uppercase, trimmed — PANs are
// case-insensitive in practice) so the same PAN always fingerprints
// identically regardless of how it was typed, letting duplicate-identity
// detection work without ever decrypting stored values for the comparison
// (docs/ARCHITECTURE.md §5).
export function fingerprintPii(plaintext: string): string {
  const key = deriveKey(HMAC_KEY_INFO);
  const normalized = plaintext.trim().toUpperCase();
  return createHmac('sha256', key).update(normalized).digest('hex');
}

export function last4(plaintext: string): string {
  const trimmed = plaintext.trim();
  return trimmed.slice(-4);
}
