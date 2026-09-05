import * as argon2 from 'argon2';

// Argon2id, m=19456 (19 MiB), t=2, p=1 — current OWASP-recommended minimum
// parameters. Never change these silently: a parameter change should
// re-hash on next successful login (needsRehash below), not invalidate
// every existing password.
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    // A malformed/foreign hash format throws rather than returning false —
    // treat it as a failed verification, not a crash.
    return false;
  }
}

// Lets login opportunistically upgrade a hash created with older parameters
// without forcing a mass password reset.
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2_OPTIONS);
}
