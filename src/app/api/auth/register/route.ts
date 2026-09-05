import { db } from '@/db';
import { profiles, users } from '@/db/schema';
import { registerSchema } from '@/lib/auth/schemas';
import { hashPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { setSessionCookie } from '@/lib/auth/cookies';
import { logAudit } from '@/lib/auth/audit';
import { isUniqueViolation } from '@/lib/db-errors';

// Registration is a plain customer account — no role is assigned here.
// Ownership-based access (a user sees their own orders) doesn't need RBAC;
// permissions (src/lib/auth/rbac.ts) exist for staff/admin capabilities and
// are granted separately (scripts/seed/roles-permissions.ts, or an admin
// action once Phase 9 ships user.suspend/role.manage UI).
export async function POST(request: Request) {
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
