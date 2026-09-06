import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { loginSchema } from '@/lib/auth/schemas';
import { hashPassword, needsRehash, verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { setSessionCookie } from '@/lib/auth/cookies';
import { logAudit } from '@/lib/auth/audit';
import { checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/net';

// A hash of a random, never-used password — computed once at module load,
// not per request. When the email doesn't exist we still run a full
// argon2.verify against this, so an unknown email costs the same wall-clock
// time as a wrong password on a real account, and the response is
// byte-identical either way (docs/ARCHITECTURE.md §4, rule 14: account
// enumeration is closed).
const DUMMY_HASH_PROMISE = hashPassword(`no-such-user-${crypto.randomUUID()}`);

const GENERIC_ERROR = { error: 'Invalid email or password' };

// Rate-limited by email always (works regardless of whether a trusted
// reverse proxy is configured) and by IP additionally when one is
// available (src/lib/net.ts) — a wider net against distributed
// credential-stuffing across many accounts from one source, without
// depending on IP trust being available everywhere this runs
// (docs/ARCHITECTURE.md §27).
const EMAIL_LIMIT = { maxAttempts: 10, windowSeconds: 15 * 60 };
const IP_LIMIT = { maxAttempts: 30, windowSeconds: 15 * 60 };

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    // Malformed input (not "wrong credentials") is fine to report precisely
    // — it can't be used to enumerate accounts.
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { email, password } = parsed.data;
  const ipAddress = request.headers.get('x-forwarded-for') ?? undefined;
  const userAgent = request.headers.get('user-agent') ?? undefined;

  const emailLimit = await checkRateLimit(`login:email:${email}`, EMAIL_LIMIT);
  if (!emailLimit.allowed) return rateLimitedResponse(emailLimit.retryAfterSeconds!);

  const trustedIp = getClientIp(request);
  if (trustedIp) {
    const ipLimit = await checkRateLimit(`login:ip:${trustedIp}`, IP_LIMIT);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds!);
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  const hashToCheck = user?.passwordHash ?? (await DUMMY_HASH_PROMISE);
  const passwordOk = await verifyPassword(hashToCheck, password);

  if (!user || !passwordOk || user.suspendedAt) {
    await logAudit({
      actorUserId: user?.id ?? null,
      action: 'auth.login',
      outcome: 'DENIED',
      ipAddress,
      metadata: { emailAttempted: email },
    });
    return Response.json(GENERIC_ERROR, { status: 401 });
  }

  // Opportunistic upgrade: a hash created under older Argon2id parameters
  // gets re-hashed under the current ones on next successful login, rather
  // than requiring a mass password reset when ARGON2_OPTIONS ever changes
  // (src/lib/auth/password.ts's own doc comment on needsRehash).
  if (needsRehash(user.passwordHash)) {
    await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, user.id));
  }

  const { token, session } = await createSession(user.id, { ipAddress, userAgent });
  await setSessionCookie(token, session.absoluteExpiresAt);
  await logAudit({ actorUserId: user.id, action: 'auth.login', outcome: 'ALLOWED', ipAddress });

  // The session row exists and the cookie is set either way — but for an
  // MFA-enabled account it's created with mfaVerifiedAt still null, which
  // the actor guard (src/lib/auth/actor.ts) treats exactly like an expired
  // session until POST /api/auth/mfa/verify clears it. `mfaRequired` here
  // is just the client-facing signal to prompt for that second step next,
  // not a separate authorization state of its own.
  return Response.json({ ok: true, mfaRequired: user.mfaEnabled });
}
