import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { mfaRecoveryCodes, mfaUsedCodes, sessions } from '@/db/schema';
import { getSessionCookie } from '@/lib/auth/cookies';
import { validateSessionToken } from '@/lib/auth/session';
import { mfaCodeSchema } from '@/lib/auth/schemas';
import { decryptMfaSecret } from '@/lib/crypto/mfa-secret';
import { verifyTotpCode } from '@/lib/auth/totp';
import {
  looksLikeRecoveryCode,
  normalizeRecoveryCodeInput,
  verifyRecoveryCode,
} from '@/lib/auth/mfa-recovery-codes';
import { checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { isUniqueViolation } from '@/lib/db-errors';
import { logAudit } from '@/lib/auth/audit';

// The login-time MFA challenge. Deliberately does NOT go through
// requireActor()/getActor() — those refuse a session that hasn't answered
// its challenge yet (src/lib/auth/actor.ts), which is exactly the session
// this route exists to unblock. Reads the session cookie and validates it
// directly instead, the one place in this codebase that's allowed to look
// at a not-yet-MFA-verified session.
export async function POST(request: Request) {
  const token = await getSessionCookie();
  if (!token) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validated = await validateSessionToken(token);
  if (!validated) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { user, session } = validated;

  if (!user.mfaEnabled) {
    return Response.json({ error: 'MFA is not enabled for this account' }, { status: 400 });
  }
  if (session.mfaVerifiedAt) {
    return Response.json({ ok: true }); // already verified — idempotent, not an error
  }
  if (!user.mfaSecretEncrypted) {
    // Should be unreachable (mfaEnabled only ever gets set alongside a
    // secret — see the enable route) — treated as a hard failure rather
    // than silently waved through if it ever did happen.
    return Response.json({ error: 'Account MFA configuration is inconsistent — contact support' }, { status: 500 });
  }

  // Keyed by session, not user — a stolen/guessed session cookie is
  // exactly the threat this rate limit exists to blunt, and it needs to
  // apply even though the caller isn't (yet) a resolvable "actor". A
  // 6-digit TOTP code has only 3 valid values at any instant (current
  // step ± the drift window) out of 1,000,000 possible — 5 attempts per 5
  // minutes makes brute-forcing that infeasible long before the window
  // rolls over.
  const limit = await checkRateLimit(`mfa:session:${session.id}`, { maxAttempts: 5, windowSeconds: 300 });
  if (!limit.allowed) return rateLimitedResponse(limit.retryAfterSeconds!);

  const body = await request.json().catch(() => null);
  const parsed = mfaCodeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const verified = /^\d{6}$/.test(parsed.data.code)
    ? await verifyByTotp(user.id, user.mfaSecretEncrypted, parsed.data.code)
    : await verifyByRecoveryCode(user.id, parsed.data.code);

  if (!verified) {
    await logAudit({ actorUserId: user.id, action: 'auth.mfa_verify', outcome: 'DENIED' });
    return Response.json({ error: 'Invalid code' }, { status: 400 });
  }

  await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, session.id));
  await logAudit({ actorUserId: user.id, action: 'auth.mfa_verify', outcome: 'ALLOWED' });

  return Response.json({ ok: true });
}

async function verifyByTotp(userId: string, secretEncrypted: string, code: string): Promise<boolean> {
  const secret = decryptMfaSecret(secretEncrypted);
  const timeStep = verifyTotpCode(secret, code);
  if (timeStep === null) return false;

  try {
    // The insert itself IS the replay guard (mfa_used_codes_uidx on
    // (userId, timeStep)) — a cryptographically valid code presented twice
    // within its own 30s window is rejected the second time, not just
    // logged.
    await db.insert(mfaUsedCodes).values({ userId, timeStep });
    return true;
  } catch (err) {
    if (isUniqueViolation(err, 'mfa_used_codes_uidx')) return false;
    throw err;
  }
}

async function verifyByRecoveryCode(userId: string, rawInput: string): Promise<boolean> {
  const normalized = normalizeRecoveryCodeInput(rawInput);
  if (!looksLikeRecoveryCode(normalized)) return false;

  const unused = await db
    .select()
    .from(mfaRecoveryCodes)
    .where(eq(mfaRecoveryCodes.userId, userId));

  for (const row of unused) {
    if (row.usedAt) continue;
    if (await verifyRecoveryCode(row.codeHash, normalized)) {
      // Single-use: an UPDATE guarded on usedAt still being NULL, so two
      // concurrent requests racing the same recovery code can't both win.
      const [claimed] = await db
        .update(mfaRecoveryCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(mfaRecoveryCodes.id, row.id), isNull(mfaRecoveryCodes.usedAt)))
        .returning({ id: mfaRecoveryCodes.id });
      if (claimed) return true;
      // Lost the race to another concurrent request using the same code —
      // treat as invalid rather than falling through to try more rows.
      return false;
    }
  }
  return false;
}
