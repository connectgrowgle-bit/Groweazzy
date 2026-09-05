import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { loginSchema } from '@/lib/auth/schemas';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { setSessionCookie } from '@/lib/auth/cookies';
import { logAudit } from '@/lib/auth/audit';

// A hash of a random, never-used password — computed once at module load,
// not per request. When the email doesn't exist we still run a full
// argon2.verify against this, so an unknown email costs the same wall-clock
// time as a wrong password on a real account, and the response is
// byte-identical either way (docs/ARCHITECTURE.md §4, rule 14: account
// enumeration is closed).
const DUMMY_HASH_PROMISE = hashPassword(`no-such-user-${crypto.randomUUID()}`);

const GENERIC_ERROR = { error: 'Invalid email or password' };

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

  const { token, session } = await createSession(user.id, { ipAddress, userAgent });
  await setSessionCookie(token, session.absoluteExpiresAt);
  await logAudit({ actorUserId: user.id, action: 'auth.login', outcome: 'ALLOWED', ipAddress });

  return Response.json({ ok: true });
}
