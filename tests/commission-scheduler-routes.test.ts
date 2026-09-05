import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { commissionEntries, commissionPolicies, jobRuns, payments } from '@/db/schema';
import { recordConversion } from '@/lib/attribution/commission';
import { createTestAffiliate, createTestOrder, deleteTestOrder, deleteTestUser } from './helpers';
import { TEST_SERVER_URL } from './global-setup';

const BASE_URL = TEST_SERVER_URL;
// Matches tests/setup.ts / tests/test-env-constants.ts's SHARED_TEST_ENV —
// both the vitest process and the spawned HTTP test server this file talks
// to are configured with this exact value.
const CRON_SECRET = 'test-only-cron-secret';
const JOB_NAME = 'release_matured_commissions';

const createdUserIds: string[] = [];
const createdOrderIds: string[] = [];
const createdPolicyIds: string[] = [];

afterEach(async () => {
  while (createdOrderIds.length) {
    const id = createdOrderIds.pop();
    if (id) await deleteTestOrder(id);
  }
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
  while (createdPolicyIds.length) {
    const id = createdPolicyIds.pop();
    if (id) await db.delete(commissionPolicies).where(eq(commissionPolicies.id, id));
  }
  // job_runs is otherwise untouched by the rest of the suite (grep
  // confirms this is the only file that exercises the cron route), so a
  // blanket sweep by job name is safe and simpler than tracking each run's
  // own id back through a response body that doesn't return one.
  await db.delete(jobRuns).where(eq(jobRuns.jobName, JOB_NAME));
});

describe('POST /api/cron/release-commissions (real server, real Postgres)', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await fetch(`${BASE_URL}/api/cron/release-commissions`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong bearer token', async () => {
    const res = await fetch(`${BASE_URL}/api/cron/release-commissions`, {
      method: 'POST',
      headers: { authorization: 'Bearer not-the-real-secret' },
    });
    expect(res.status).toBe(401);
  });

  it('runs the release job on a correct bearer token and records a SUCCEEDED job_runs row', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);
    const order = await createTestOrder({ userId: user.id, amountPaise: 1000000, stage: 'PAID' });
    createdOrderIds.push(order.id);
    await db.insert(payments).values({
      purpose: 'SERVICE_ORDER',
      orderId: order.id,
      amountPaise: 1000000,
      status: 'CAPTURED',
      razorpayOrderId: `order_test_${randomUUID()}`,
    });
    const [policy] = await db
      .insert(commissionPolicies)
      .values({ commissionRateBasisPoints: 1000, effectiveFrom: new Date(Date.now() + 60_000) })
      .returning();
    if (!policy) throw new Error('failed to insert test commission policy');
    createdPolicyIds.push(policy.id);
    const { entry } = await recordConversion({ orderId: order.id, affiliateId: affiliate.id });
    await db
      .update(commissionEntries)
      .set({ status: 'APPROVED', holdReleaseAt: new Date(Date.now() - 1000) })
      .where(eq(commissionEntries.id, entry.id));

    const res = await fetch(`${BASE_URL}/api/cron/release-commissions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('completed');
    expect(body.released).toBeGreaterThanOrEqual(1);

    const [releasedEntry] = await db.select().from(commissionEntries).where(eq(commissionEntries.id, entry.id));
    expect(releasedEntry?.status).toBe('AVAILABLE');

    const [run] = await db.select().from(jobRuns).where(eq(jobRuns.jobName, JOB_NAME));
    expect(run?.status).toBe('SUCCEEDED');
    expect(run?.finishedAt).not.toBeNull();
  });

  it('GET is also accepted, for schedulers that only send GET', async () => {
    const res = await fetch(`${BASE_URL}/api/cron/release-commissions`, {
      method: 'GET',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('completed');
  });
});
