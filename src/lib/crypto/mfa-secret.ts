import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { getEnv } from '@/lib/env';

// TOTP secrets get their OWN AES-256-GCM encryption-at-rest — deliberately
// not routed through src/lib/crypto/pii.ts's encryptPii/decryptPii, even
// though the scheme underneath is identical. That file's own comment
// explains why: HKDF derives INDEPENDENT subkeys per purpose from the one
// PII_ENCRYPTION_KEY master secret specifically so a bug in one operation
// can't leak key material useful against another. An MFA secret is a
// different class of sensitive value from KYC PAN/bank data, not a
// variation of the same one, so it gets its own fixed `info` string and
// its own derived subkey — reusing the same master key (there is only one
// configured secret in this app) but never the same derived key bytes.
const MFA_KEY_INFO = Buffer.from('groweazzy-mfa-secret-v1', 'utf8');
const EMPTY_SALT = Buffer.alloc(0);
const ENCRYPTION_FORMAT_VERSION = 'v1';

function deriveMfaKey(): Buffer {
  const env = getEnv();
  const masterKey = Buffer.from(env.PII_ENCRYPTION_KEY, 'hex');
  return Buffer.from(hkdfSync('sha256', masterKey, EMPTY_SALT, MFA_KEY_INFO, 32));
}

// Format: "v1.<ivHex>.<authTagHex>.<ciphertextHex>" — same versioned shape
// as encryptPii, for the same reason (lets a future scheme change tell old
// and new ciphertexts apart during migration).
export function encryptMfaSecret(plaintext: string): string {
  const key = deriveMfaKey();
  const iv = randomBytes(12); // 96-bit IV, the GCM-recommended size
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [ENCRYPTION_FORMAT_VERSION, iv.toString('hex'), authTag.toString('hex'), ciphertext.toString('hex')].join(
    '.'
  );
}

export function decryptMfaSecret(encrypted: string): string {
  const [version, ivHex, authTagHex, ciphertextHex] = encrypted.split('.');
  if (version !== ENCRYPTION_FORMAT_VERSION || !ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed or unrecognized encrypted MFA secret value');
  }
  const key = deriveMfaKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}
