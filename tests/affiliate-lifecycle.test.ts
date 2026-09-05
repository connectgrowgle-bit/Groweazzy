import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliates } from '@/db/schema';
import { transitionAffiliateStatus, InvalidTransitionError } from '@/lib/affiliate/lifecycle';
import { createTestAffiliate, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

describe('affiliate lifecycle state machine', () => {
  it('allows a legal transition and persists it', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'KYC_PENDING' });
    createdUserIds.push(user.id);

    const updated = await transitionAffiliateStatus(affiliate.id, 'KYC_SUBMITTED');
    expect(updated.status).toBe('KYC_SUBMITTED');

    const [row] = await db.select().from(affiliates).where(eq(affiliates.id, affiliate.id));
    expect(row?.status).toBe('KYC_SUBMITTED');
  });

  it('rejects an illegal transition and leaves the row unchanged', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'KYC_PENDING' });
    createdUserIds.push(user.id);

    await expect(transitionAffiliateStatus(affiliate.id, 'ACTIVE')).rejects.toThrow(InvalidTransitionError);

    const [row] = await db.select().from(affiliates).where(eq(affiliates.id, affiliate.id));
    expect(row?.status).toBe('KYC_PENDING');
  });

  it('TERMINATED is a dead end — no transition leaves it', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'TERMINATED' });
    createdUserIds.push(user.id);

    await expect(transitionAffiliateStatus(affiliate.id, 'ACTIVE')).rejects.toThrow(InvalidTransitionError);
    await expect(transitionAffiliateStatus(affiliate.id, 'SUSPENDED')).rejects.toThrow(InvalidTransitionError);
  });

  it('applies extra fields (e.g. activatedAt) atomically with the status change', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'FEE_PENDING' });
    createdUserIds.push(user.id);

    const now = new Date();
    await transitionAffiliateStatus(affiliate.id, 'ACTIVE', { activatedAt: now });

    const [row] = await db.select().from(affiliates).where(eq(affiliates.id, affiliate.id));
    expect(row?.status).toBe('ACTIVE');
    expect(row?.activatedAt?.getTime()).toBeCloseTo(now.getTime(), -2);
  });

  it('two concurrent transitions racing on the same affiliate: exactly one wins', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'KYC_SUBMITTED' });
    createdUserIds.push(user.id);

    // KYC_SUBMITTED allows both KYC_REJECTED and ACTIVE — race two
    // contradictory transitions against the same row. The row-level lock
    // (`for('update')`) in transitionAffiliateStatus means these serialize:
    // whichever commits first wins, and the second sees the already-changed
    // status and correctly fails as an illegal transition from there.
    const results = await Promise.allSettled([
      transitionAffiliateStatus(affiliate.id, 'ACTIVE'),
      transitionAffiliateStatus(affiliate.id, 'KYC_REJECTED'),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The database is the source of truth — confirm it landed in exactly
    // one of the two possible end states, not something in between.
    const [row] = await db.select().from(affiliates).where(eq(affiliates.id, affiliate.id));
    expect(['ACTIVE', 'KYC_REJECTED']).toContain(row?.status);
  });
});
