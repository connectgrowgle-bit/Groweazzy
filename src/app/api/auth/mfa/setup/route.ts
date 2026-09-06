import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { requireActor } from '@/lib/auth/actor';
import { encryptMfaSecret } from '@/lib/crypto/mfa-secret';
import { buildOtpauthUrl, generateTotpSecret } from '@/lib/auth/totp';

// Step 1 of enrollment: generates a fresh secret, stores it encrypted, and
// hands the PLAINTEXT secret + otpauth:// URI back to this one authenticated
// response — the only time either ever leaves the server unencrypted. MFA
// is not actually turned on yet (users.mfaEnabled stays false) until
// POST /api/auth/mfa/enable proves the user captured it correctly by
// submitting a real code generated from it.
//
// Calling this again before enabling simply overwrites the pending secret
// — there is nothing to "cancel," a user can always just scan a fresh QR
// code / re-copy a fresh manual-entry secret and try again.
export async function POST() {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  if (actor.user.mfaEnabled) {
    return Response.json({ error: 'MFA is already enabled — disable it first to re-enroll' }, { status: 400 });
  }

  const secret = generateTotpSecret();
  await db.update(users).set({ mfaSecretEncrypted: encryptMfaSecret(secret) }).where(eq(users.id, actor.user.id));

  const otpauthUrl = buildOtpauthUrl({ secretBase32: secret, accountEmail: actor.user.email, issuer: 'GrowEazzy' });

  return Response.json({ secret, otpauthUrl });
}
