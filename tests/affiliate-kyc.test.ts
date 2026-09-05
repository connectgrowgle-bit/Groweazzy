import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliateKyc, affiliates, commissionPolicies } from '@/db/schema';
import { submitKyc, reviewKyc, DuplicatePanError, InvalidStateForKycError } from '@/lib/affiliate/kyc';
import { createTestAffiliate, createTestUser, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];
const createdPolicyIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
  while (createdPolicyIds.length) {
    const id = createdPolicyIds.pop();
    if (id) await db.delete(commissionPolicies).where(eq(commissionPolicies.id, id));
  }
});

function randomPan(): string {
  const letters = () =>
    Array.from({ length: 5 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]).join('');
  const digits = () => Math.floor(1000 + Math.random() * 9000).toString();
  const lastLetter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
  return `${letters()}${digits()}${lastLetter}`;
}

async function makeReviewer() {
  const { user } = await createTestUser();
  createdUserIds.push(user.id);
  return user;
}

// Inserts a commission policy that will be the "current" one (latest
// effectiveFrom) for the duration of a test, without disturbing whatever
// policy real seed/dev data left in this database.
async function setCurrentPolicy(fields: { registrationFeeEnabled: 'true' | 'false' }) {
  const [policy] = await db
    .insert(commissionPolicies)
    .values({ effectiveFrom: new Date(Date.now() + 60_000), ...fields })
    .returning();
  if (!policy) throw new Error('failed to insert test commission policy');
  createdPolicyIds.push(policy.id);
  return policy;
}

describe('affiliate KYC', () => {
  it('submitting KYC encrypts PAN and bank details at rest and transitions to KYC_SUBMITTED', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'KYC_PENDING' });
    createdUserIds.push(user.id);
    const pan = randomPan();

    const kyc = await submitKyc(affiliate.id, { pan, bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' });

    expect(kyc.status).toBe('SUBMITTED');
    expect(kyc.panLast4).toBe(pan.slice(-4));

    // Read the raw row back — the whole point of this feature is that the
    // database itself never holds the plaintext.
    const [kycRow] = await db.select().from(affiliateKyc).where(eq(affiliateKyc.id, kyc.id));
    expect(kycRow?.panEncrypted).not.toContain(pan);
    expect(kycRow?.panEncrypted).toMatch(/^v1\./);

    const [affiliateRow] = await db.select().from(affiliates).where(eq(affiliates.id, affiliate.id));
    expect(affiliateRow?.status).toBe('KYC_SUBMITTED');
    expect(affiliateRow?.bankAccountEncrypted).not.toContain('123456789012');
    expect(affiliateRow?.bankAccountLast4).toBe('9012');
  });

  it('rejects submission from a status that is not KYC_PENDING or KYC_REJECTED', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'ACTIVE' });
    createdUserIds.push(user.id);

    await expect(
      submitKyc(affiliate.id, { pan: randomPan(), bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234' })
    ).rejects.toThrow(InvalidStateForKycError);
  });

  it('a rejected KYC can be resubmitted, creating a new submission', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'KYC_PENDING' });
    createdUserIds.push(user.id);
    const reviewer = await makeReviewer();

    const first = await submitKyc(affiliate.id, {
      pan: randomPan(),
      bankAccountNumber: '111111111111',
      bankIfsc: 'HDFC0001234',
    });
    await reviewKyc(first.id, 'REJECTED', reviewer.id, 'Illegible document');

    const [afterReject] = await db.select().from(affiliates).where(eq(affiliates.id, affiliate.id));
    expect(afterReject?.status).toBe('KYC_REJECTED');

    const second = await submitKyc(affiliate.id, {
      pan: randomPan(),
      bankAccountNumber: '222222222222',
      bankIfsc: 'HDFC0001234',
    });
    expect(second.id).not.toBe(first.id);

    const [afterResubmit] = await db.select().from(affiliates).where(eq(affiliates.id, affiliate.id));
    expect(afterResubmit?.status).toBe('KYC_SUBMITTED');

    const [firstRow] = await db.select().from(affiliateKyc).where(eq(affiliateKyc.id, first.id));
    expect(firstRow?.status).toBe('REJECTED');
  });

  it('approving KYC moves to FEE_PENDING when the registration fee is enabled', async () => {
    await setCurrentPolicy({ registrationFeeEnabled: 'true' });
    const { user, affiliate } = await createTestAffiliate({ status: 'KYC_PENDING' });
    createdUserIds.push(user.id);
    const reviewer = await makeReviewer();

    const kyc = await submitKyc(affiliate.id, {
      pan: randomPan(),
      bankAccountNumber: '333333333333',
      bankIfsc: 'HDFC0001234',
    });
    await reviewKyc(kyc.id, 'APPROVED', reviewer.id);

    const [row] = await db.select().from(affiliates).where(eq(affiliates.id, affiliate.id));
    expect(row?.status).toBe('FEE_PENDING');
    expect(row?.activatedAt).toBeNull();
  });

  it('approving KYC activates immediately, skipping FEE_PENDING, when the fee is disabled', async () => {
    await setCurrentPolicy({ registrationFeeEnabled: 'false' });
    const { user, affiliate } = await createTestAffiliate({ status: 'KYC_PENDING' });
    createdUserIds.push(user.id);
    const reviewer = await makeReviewer();

    const kyc = await submitKyc(affiliate.id, {
      pan: randomPan(),
      bankAccountNumber: '444444444444',
      bankIfsc: 'HDFC0001234',
    });
    await reviewKyc(kyc.id, 'APPROVED', reviewer.id);

    const [row] = await db.select().from(affiliates).where(eq(affiliates.id, affiliate.id));
    expect(row?.status).toBe('ACTIVE');
    expect(row?.activatedAt).not.toBeNull();
  });

  it('refuses to approve a PAN that is already approved on a different affiliate', async () => {
    await setCurrentPolicy({ registrationFeeEnabled: 'true' });
    const reviewer = await makeReviewer();
    const pan = randomPan();

    const first = await createTestAffiliate({ status: 'KYC_PENDING' });
    createdUserIds.push(first.user.id);
    const firstKyc = await submitKyc(first.affiliate.id, {
      pan,
      bankAccountNumber: '555555555555',
      bankIfsc: 'HDFC0001234',
    });
    await reviewKyc(firstKyc.id, 'APPROVED', reviewer.id);

    const second = await createTestAffiliate({ status: 'KYC_PENDING' });
    createdUserIds.push(second.user.id);
    const secondKyc = await submitKyc(second.affiliate.id, {
      pan, // same PAN, different affiliate
      bankAccountNumber: '666666666666',
      bankIfsc: 'HDFC0001234',
    });

    await expect(reviewKyc(secondKyc.id, 'APPROVED', reviewer.id)).rejects.toThrow(DuplicatePanError);

    // Confirm the rejection was real, not just a thrown error with the
    // database quietly changed anyway.
    const [secondKycRow] = await db.select().from(affiliateKyc).where(eq(affiliateKyc.id, secondKyc.id));
    expect(secondKycRow?.status).toBe('SUBMITTED');
    const [secondAffiliateRow] = await db.select().from(affiliates).where(eq(affiliates.id, second.affiliate.id));
    expect(secondAffiliateRow?.status).toBe('KYC_SUBMITTED');
  });
});
