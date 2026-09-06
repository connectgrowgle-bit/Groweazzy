import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { mfaRecoveryCodes, mfaUsedCodes, users } from '@/db/schema';
import { requireActor } from '@/lib/auth/actor';
import { verifyPassword } from '@/lib/auth/password';
import { decryptMfaSecret } from '@/lib/crypto/mfa-secret';
import { verifyTotpCode } from '@/lib/auth/totp';
import { looksLikeRecoveryCode, normalizeRecoveryCodeInput, verifyRecoveryCode } from '@/lib/auth/mfa-recovery-codes';
import { checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { z } from 'zod';

// Turning MFA OFF is exactly as sensitive as turning it on, arguably more
// so — this is the route an attacker who's already stolen a live,
// MFA-verified session would want most, since it's the one action that
// permanently downgrades the account's protection. requireActor() alone
// (a valid, already-MFA-verified session) is deliberately not enough:
// this also re-checks the password AND a fresh code, the same
// belt-and-suspenders a password change gets on most real platforms.
const disableSchema = z.object({
  password: z.string().min(1, 'Password is required'),
  code: z.string().trim().min(1, 'Code is required').max(20),
});

export async function POST(request: Request) {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  if (!actor.user.mfaEnabled || !actor.user.mfaSecretEncrypted) {
    return Response.json({ error: 'MFA is not enabled' }, { status: 400 });
  }

  const limit = await checkRateLimit(`mfa:disable:${actor.user.id}`, { maxAttempts: 5, windowSeconds: 300 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds!);

  const body = await request.json().catch(() => null);
  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const passwordOk = await verifyPassword(actor.user.passwordHash, parsed.data.password);
  if (!passwordOk) {
    return Response.json({ error: 'Incorrect password' }, { status: 400 });
  }

  const codeOk = await verifyDisableCode(actor.user.id, actor.user.mfaSecretEncrypted, parsed.data.code);
  if (!codeOk) {
    return Response.json({ error: 'Invalid code' }, { status: 400 });
  }

  await db.transaction(async (tx) => {
    await tx.update(users).set({ mfaEnabled: false, mfaSecretEncrypted: null }).where(eq(users.id, actor.user.id));
    // Recovery codes and used-code replay records are specific to the
    // secret that's being thrown away — leaving them would let a future
    // re-enrollment inherit a stale set of "recovery" codes that no longer
    // correspond to anything, or leave old timeStep rows around forever
    // for no reason once the secret they guarded no longer exists.
    await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, actor.user.id));
    await tx.delete(mfaUsedCodes).where(eq(mfaUsedCodes.userId, actor.user.id));
  });

  return Response.json({ ok: true });
}

// Accepts either a live TOTP code or a recovery code — same dispatch as
// the login-time challenge (src/app/api/auth/mfa/verify/route.ts), minus
// the replay-protection insert for TOTP: this is a one-shot confirmation
// on an action that immediately deletes the whole MFA configuration
// afterward, so there is no future "next run" a replayed code could be
// reused against — the used_codes table this would otherwise write to is
// deleted in the same transaction moments later regardless.
async function verifyDisableCode(userId: string, secretEncrypted: string, code: string): Promise<boolean> {
  if (/^\d{6}$/.test(code)) {
    const secret = decryptMfaSecret(secretEncrypted);
    return verifyTotpCode(secret, code) !== null;
  }

  const normalized = normalizeRecoveryCodeInput(code);
  if (!looksLikeRecoveryCode(normalized)) return false;

  const unused = await db.select().from(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
  for (const row of unused) {
    if (row.usedAt) continue;
    if (await verifyRecoveryCode(row.codeHash, normalized)) return true;
  }
  return false;
}
