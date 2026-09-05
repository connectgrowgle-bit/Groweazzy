import { db } from '@/db';
import { profiles, users } from '@/db/schema';
import { registerSchema } from '@/lib/auth/schemas';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { setSessionCookie } from '@/lib/auth/cookies';
import { logAudit } from '@/lib/auth/audit';
import { isUniqueViolation } from '@/lib/db-errors';
import { checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/net';

// Registration is a plain customer account — no role is assigned here.
// Ownership-based access (a user sees their own orders) doesn't need RBAC;
// permissions (src/lib/auth/rbac.ts) exist for staff/admin capabilities and
// are granted separately (scripts/seed/roles-permissions.ts, or an admin
// action once Phase 9 ships user.suspend/role.manage UI).
//
// Deliberate, scoped exception to rule 14's "account enumeration is
// closed": the 409 below DOES reveal that an email is already registered.
// Login stays hardened (generic error, timing-safe, rate-limited) because
// that's the higher-value target for credential stuffing; here, telling a
// genuine user "you already have an account, log in instead" is real UX
// value with no email-sending flow built to route around it instead
// (docs/ARCHITECTURE.md §27) — not an oversight of the same principle,
// a considered trade-off on a lower-stakes endpoint.
const IP_LIMIT = { maxAttempts: 10, windowSeconds: 60 * 60 };

export async function POST(request: Request) {
  const trustedIp = getClientIp(request);
  if (trustedIp) {
    const ipLimit = await checkRateLimit(`register:ip:${trustedIp}`, IP_LIMIT);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds!);
  }

  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { fullName, email, password } = parsed.data;

  const passwordHash = await hashPassword(password);

  let userId: string;
  try {
    const [user] = await db.transaction(async (tx) => {
      const inserted = await tx.insert(users).values({ email, passwordHash }).returning();
      const newUser = inserted[0];
      if (!newUser) throw new Error('insert did not return a row');
      await tx.insert(profiles).values({ userId: newUser.id, fullName });
      return [newUser];
    });
    if (!user) throw new Error('unreachable');
    userId = user.id;
  } catch (err) {
    if (isUniqueViolation(err, 'users_email_uidx')) {
      return Response.json({ error: 'An account with this email already exists' }, { status: 409 });
    }
    throw err;
  }

  const ipAddress = request.headers.get('x-forwarded-for') ?? undefined;
  const userAgent = request.headers.get('user-agent') ?? undefined;
  const { token, session } = await createSession(userId, { ipAddress, userAgent });
  await setSessionCookie(token, session.absoluteExpiresAt);
  await logAudit({ actorUserId: userId, action: 'auth.register', outcome: 'ALLOWED', ipAddress });

  return Response.json({ ok: true }, { status: 201 });
}
