import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { rateLimitBuckets } from '@/db/schema';
import { checkRateLimit } from '@/lib/rate-limit';

const createdKeys: string[] = [];

function testKey(label: string): string {
  const key = `test:${label}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  createdKeys.push(key);
  return key;
}

afterEach(async () => {
  while (createdKeys.length) {
    const key = createdKeys.pop();
    if (key) await db.delete(rateLimitBuckets).where(eq(rateLimitBuckets.key, key));
  }
});

describe('checkRateLimit (src/lib/rate-limit.ts)', () => {
  it('allows up to maxAttempts within the window, then blocks', async () => {
    const key = testKey('basic');
    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit(key, { maxAttempts: 3, windowSeconds: 60 });
      expect(result.allowed).toBe(true);
    }
    const blocked = await checkRateLimit(key, { maxAttempts: 3, windowSeconds: 60 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('resets the count once the window has fully elapsed', async () => {
    const key = testKey('window-reset');
    await checkRateLimit(key, { maxAttempts: 1, windowSeconds: 1 });
    const blocked = await checkRateLimit(key, { maxAttempts: 1, windowSeconds: 1 });
    expect(blocked.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const afterWindow = await checkRateLimit(key, { maxAttempts: 1, windowSeconds: 1 });
    expect(afterWindow.allowed).toBe(true);
  });

  it('tracks independent keys independently', async () => {
    const keyA = testKey('independent-a');
    const keyB = testKey('independent-b');
    await checkRateLimit(keyA, { maxAttempts: 1, windowSeconds: 60 });
    const blockedA = await checkRateLimit(keyA, { maxAttempts: 1, windowSeconds: 60 });
    const stillAllowedB = await checkRateLimit(keyB, { maxAttempts: 1, windowSeconds: 60 });

    expect(blockedA.allowed).toBe(false);
    expect(stillAllowedB.allowed).toBe(true);
  });

  it('serializes concurrent hits against the same key rather than double-counting past the limit', async () => {
    const key = testKey('concurrent');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkRateLimit(key, { maxAttempts: 5, windowSeconds: 60 }))
    );
    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(5);
  });
});
