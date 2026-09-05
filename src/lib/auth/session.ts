import { randomBytes, createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users, type sessionRevokedReasonEnum } from '@/db/schema';

const SLIDING_WINDOW_MS = 30 * 60 * 1000; // 30 minutes of inactivity logs you out
const ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, never extended

type RevokedReason = (typeof sessionRevokedReasonEnum.enumValues)[number];

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type SessionMeta = {
  ipAddress?: string;
  userAgent?: string;
};

// Returns the raw token — shown to the client exactly once, as the cookie
// value. Only its hash is ever persisted (docs/ARCHITECTURE.md §4).
export async function createSession(userId: string, meta: SessionMeta = {}) {
  const token = randomBytes(32).toString('hex');
  const now = new Date();

  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      lastActiveAt: now,
      slidingExpiresAt: new Date(now.getTime() + SLIDING_WINDOW_MS),
      absoluteExpiresAt: new Date(now.getTime() + ABSOLUTE_LIFETIME_MS),
    })
    .returning();

  if (!session) throw new Error('Failed to create session row');

  return { token, session };
}

export type ValidatedSession = {
  user: typeof users.$inferSelect;
  session: typeof sessions.$inferSelect;
};

// The single place every request's identity is established. Checks, in
// order: token exists and isn't revoked, both expiry mechanisms, and the
// sessionsValidFrom watermark — a password reset or suspension bumps that
// watermark and this check alone invalidates every prior session immediately,
// without needing to touch the sessions table at all.
export async function validateSessionToken(token: string): Promise<ValidatedSession | null> {
  const tokenHash = hashToken(token);
  const now = new Date();

  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const { session, user } = row;

  if (session.slidingExpiresAt <= now) return null;
  if (session.absoluteExpiresAt <= now) return null;
  if (session.createdAt < user.sessionsValidFrom) return null;
  if (user.suspendedAt) return null;

  return { user, session };
}

// Extends the sliding window on genuine activity. Called from the actor
// guard on authenticated requests — never on the validation check itself,
// so an expired-but-still-queried session doesn't get resurrected.
export async function touchSession(sessionId: string): Promise<void> {
  const now = new Date();
  await db
    .update(sessions)
    .set({ lastActiveAt: now, slidingExpiresAt: new Date(now.getTime() + SLIDING_WINDOW_MS) })
    .where(eq(sessions.id, sessionId));
}

export async function revokeSession(sessionId: string, reason: RevokedReason): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

// The actual mechanism behind "a suspended user loses access on their very
// next request": bump the watermark so every session ever issued —
// including ones this process doesn't know the IDs of — fails
// validateSessionToken on its next use, no enumeration of sessions required.
// Also explicitly revokes currently-active sessions for a clean audit trail.
export async function invalidateAllSessionsForUser(userId: string, reason: RevokedReason): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ sessionsValidFrom: now }).where(eq(users.id, userId));
    await tx
      .update(sessions)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  });
}
