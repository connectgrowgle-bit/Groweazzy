import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { mfaRecoveryCodes, mfaUsedCodes, sessions, users } from '@/db/schema';
import { requireActor } from '@/lib/auth/actor';
import { mfaCodeSchema } from '@/lib/auth/schemas';
import { decryptMfaSecret } from '@/lib/crypto/mfa-secret';
import { verifyTotpCode } from '@/lib/auth/totp';
import { generateRecoveryCodes, hashRecoveryCode, formatRecoveryCodeForDisplay } from '@/lib/auth/mfa-recovery-codes';
import { checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { isUniqueViolation } from '@/lib/db-errors';

// Step 2 of enrollment: proves the user actually captured the secret from
// /api/auth/mfa/setup correctly (scanned it into a real authenticator app)
// before MFA becomes load-bearing on their account. Only on success does
// this flip users.mfaEnabled to true and hand back a set of recovery codes
// — shown here, in this one response, and never again (only their Argon2id
// hashes are ever stored, same as a password).
export async function POST(request: Request) {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  if (actor.user.mfaEnabled) {
    return Response.json({ error: 'MFA is already enabled' }, { status: 400 });
  }
  if (!actor.user.mfaSecretEncrypted) {
    return Response.json({ error: 'No pending MFA setup — call /api/auth/mfa/setup first' }, { status: 400 });
  }

  // Keyed by user, not email — this route is only reachable by an already
  // authenticated actor, so there is no anonymous-caller enumeration
  // concern the way login's rate limiting has to account for.
  const limit = await checkRateLimit(`mfa:enable:${actor.user.id}`, { maxAttempts: 5, windowSeconds: 300 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds!);

  const body = await request.json().catch(() => null);
  const parsed = mfaCodeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const secret = decryptMfaSecret(actor.user.mfaSecretEncrypted);
  const timeStep = verifyTotpCode(secret, parsed.data.code);
  if (timeStep === null) {
    return Response.json({ error: 'Invalid code' }, { status: 400 });
  }

  try {
    await db.insert(mfaUsedCodes).values({ userId: actor.user.id, timeStep });
  } catch (err) {
    if (isUniqueViolation(err, 'mfa_used_codes_uidx')) {
      return Response.json({ error: 'That code has already been used — wait for the next one' }, { status: 400 });
    }
    throw err;
  }

  const rawCodes = generateRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ mfaEnabled: true }).where(eq(users.id, actor.user.id));
    // This response is the very last time this session gets to prove
    // possession before the actor guard (src/lib/auth/actor.ts) starts
    // refusing it — mark this session verified now so the browser that
    // just enrolled isn't immediately locked out of the account it's
    // sitting in.
    await tx.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, actor.session.id));
    await tx.insert(mfaRecoveryCodes).values(
      await Promise.all(rawCodes.map(async (raw) => ({ userId: actor.user.id, codeHash: await hashRecoveryCode(raw) })))
    );
  });

  return Response.json({ recoveryCodes: rawCodes.map(formatRecoveryCodeForDisplay) });
}
