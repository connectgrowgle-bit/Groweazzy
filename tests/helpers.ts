import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { hashPassword } from '@/lib/auth/password';

// Every test gets its own fixture (unique email) rather than sharing rows —
// avoids cross-test interference under fileParallelism and makes each
// test's failure independently reproducible.
export async function createTestUser(overrides: { suspended?: boolean } = {}) {
  const email = `test-${randomUUID()}@example.test`;
  const password = 'a-reasonably-strong-test-password';
  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash,
      suspendedAt: overrides.suspended ? new Date() : null,
    })
    .returning();

  if (!user) throw new Error('failed to create test user');
  return { user, email, password };
}

export async function deleteTestUser(userId: string) {
  await db.delete(users).where(eq(users.id, userId));
}
