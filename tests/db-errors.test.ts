import { describe, it, expect, afterEach } from 'vitest';
import { db } from '@/db';
import { users } from '@/db/schema';
import { isUniqueViolation } from '@/lib/db-errors';
import { createTestUser, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('isUniqueViolation', () => {
  it('detects a real duplicate-key error against a real Postgres unique index', async () => {
    const { user, email } = await createTestUser();
    createdUserIds.push(user.id);

    let caught: unknown;
    try {
      await db.insert(users).values({ email, passwordHash: 'irrelevant' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    // Confirms this doesn't regress into mistake #4 (docs/ARCHITECTURE.md
    // §15): checking err.message for "duplicate key" text, which Drizzle's
    // node-postgres driver never puts there.
    expect(isUniqueViolation(caught, 'users_email_uidx')).toBe(true);
    expect(isUniqueViolation(caught, 'some_other_constraint')).toBe(false);
  });

  it('returns false for an unrelated error', () => {
    expect(isUniqueViolation(new Error('totally unrelated'))).toBe(false);
    expect(isUniqueViolation('not even an Error instance')).toBe(false);
  });
});
