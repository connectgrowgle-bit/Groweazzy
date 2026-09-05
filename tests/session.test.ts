import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';
import { createSession, validateSessionToken, touchSession, revokeSession, invalidateAllSessionsForUser } from '@/lib/auth/session';
import { createTestUser, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('session lifecycle', () => {
  it('creates a session row and validates it back from a fresh token', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);

    const { token, session } = await createSession(user.id, { ipAddress: '127.0.0.1' });

    // Read the database back rather than trusting the return value alone.
    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row).toBeDefined();
    expect(row?.userId).toBe(user.id);
    expect(row?.revokedAt).toBeNull();

    const validated = await validateSessionToken(token);
    expect(validated?.user.id).toBe(user.id);
    expect(validated?.session.id).toBe(session.id);
  });

  it('rejects a token that does not match any session', async () => {
    const validated = await validateSessionToken('not-a-real-token-at-all');
    expect(validated).toBeNull();
  });

  it('rejects a revoked session', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const { token, session } = await createSession(user.id);

    await revokeSession(session.id, 'LOGOUT');

    expect(await validateSessionToken(token)).toBeNull();
    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revokedReason).toBe('LOGOUT');
  });

  it('rejects a session past its sliding expiry', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const { token, session } = await createSession(user.id);

    await db.update(sessions).set({ slidingExpiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, session.id));

    expect(await validateSessionToken(token)).toBeNull();
  });

  it('rejects a session past its absolute expiry even if sliding was extended', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const { token, session } = await createSession(user.id);

    await db
      .update(sessions)
      .set({
        // Sliding window looks fine on its own...
        slidingExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        // ...but the absolute cap has passed, and that must still win.
        absoluteExpiresAt: new Date(Date.now() - 1000),
      })
      .where(eq(sessions.id, session.id));

    expect(await validateSessionToken(token)).toBeNull();
  });

  it('rejects a session created before the user\'s sessionsValidFrom watermark', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const { token } = await createSession(user.id);

    // Simulate a password reset happening after this session was issued.
    await db.update(users).set({ sessionsValidFrom: new Date(Date.now() + 1000) }).where(eq(users.id, user.id));

    expect(await validateSessionToken(token)).toBeNull();
  });

  it('rejects every session for a suspended user', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const { token } = await createSession(user.id);

    await db.update(users).set({ suspendedAt: new Date() }).where(eq(users.id, user.id));

    expect(await validateSessionToken(token)).toBeNull();
  });

  it('touchSession extends the sliding window', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const { session } = await createSession(user.id);

    const before = session.slidingExpiresAt.getTime();
    await new Promise((r) => setTimeout(r, 10));
    await touchSession(session.id);

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id));
    expect(row?.slidingExpiresAt.getTime()).toBeGreaterThan(before);
  });

  it('invalidateAllSessionsForUser revokes every active session and bumps the watermark', async () => {
    const { user } = await createTestUser();
    createdUserIds.push(user.id);
    const a = await createSession(user.id);
    const b = await createSession(user.id);

    expect(await validateSessionToken(a.token)).not.toBeNull();
    expect(await validateSessionToken(b.token)).not.toBeNull();

    await invalidateAllSessionsForUser(user.id, 'PASSWORD_RESET');

    // Both existing sessions are invalid immediately...
    expect(await validateSessionToken(a.token)).toBeNull();
    expect(await validateSessionToken(b.token)).toBeNull();

    // ...verified from the database, not just the validation function: the
    // watermark mechanism means even a session this process never issued
    // (or has forgotten the ID of) would fail the same way.
    const [userRow] = await db.select().from(users).where(eq(users.id, user.id));
    const sessionRows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(userRow?.sessionsValidFrom.getTime()).toBeGreaterThanOrEqual(a.session.createdAt.getTime());
    expect(sessionRows.every((s) => s.revokedAt !== null && s.revokedReason === 'PASSWORD_RESET')).toBe(true);
  });
});
