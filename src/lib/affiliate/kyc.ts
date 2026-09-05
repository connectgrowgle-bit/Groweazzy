import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { affiliateKyc, affiliates } from '@/db/schema';
import { encryptPii, decryptPii, fingerprintPii, last4 } from '@/lib/crypto/pii';
import { isUniqueViolation } from '@/lib/db-errors';
import { transitionAffiliateStatus, InvalidTransitionError } from './lifecycle';
import { getCurrentCommissionPolicy } from './commission-policy';

export type KycInput = {
  pan: string;
  bankAccountNumber: string;
  bankIfsc: string;
};

export class InvalidStateForKycError extends Error {
  constructor(currentStatus: string) {
    super(`Cannot submit KYC while affiliate status is ${currentStatus}`);
    this.name = 'InvalidStateForKycError';
  }
}

// KYC happens before the fee is charged (docs/ARCHITECTURE.md §5) —
// submitting is legal from KYC_PENDING directly, or from KYC_REJECTED via
// an implicit KYC_REJECTED -> KYC_PENDING hop first (resubmission after a
// rejection), never from any other status.
export async function submitKyc(affiliateId: string, input: KycInput): Promise<typeof affiliateKyc.$inferSelect> {
  const [affiliate] = await db.select().from(affiliates).where(eq(affiliates.id, affiliateId));
  if (!affiliate) throw new Error(`No such affiliate: ${affiliateId}`);

  if (affiliate.status === 'KYC_REJECTED') {
    await transitionAffiliateStatus(affiliateId, 'KYC_PENDING');
  } else if (affiliate.status !== 'KYC_PENDING') {
    throw new InvalidStateForKycError(affiliate.status);
  }

  const panEncrypted = encryptPii(input.pan);
  const panLast4 = last4(input.pan);
  const panFingerprint = fingerprintPii(input.pan);
  const bankAccountEncrypted = encryptPii(input.bankAccountNumber);
  const bankAccountLast4 = last4(input.bankAccountNumber);

  let kyc: typeof affiliateKyc.$inferSelect | undefined;
  try {
    [kyc] = await db
      .insert(affiliateKyc)
      .values({ affiliateId, panEncrypted, panLast4, panFingerprint })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err, 'affiliate_kyc_one_active_uidx')) {
      // The partial unique index (drizzle/manual/0001_partial_indexes.sql)
      // caught a race — two concurrent submissions for the same affiliate.
      throw new InvalidStateForKycError(affiliate.status);
    }
    throw err;
  }
  if (!kyc) throw new Error('Insert did not return a row');

  await db
    .update(affiliates)
    .set({ bankAccountEncrypted, bankAccountLast4, bankIfsc: input.bankIfsc, updatedAt: new Date() })
    .where(eq(affiliates.id, affiliateId));

  await transitionAffiliateStatus(affiliateId, 'KYC_SUBMITTED');

  return kyc;
}

export type KycReviewDecision = 'APPROVED' | 'REJECTED';

export class DuplicatePanError extends Error {
  constructor() {
    super('This PAN is already approved on a different affiliate account');
    this.name = 'DuplicatePanError';
  }
}

// Approving KYC additionally checks the panFingerprint against every other
// *already-approved* affiliate — the actual use of the keyed HMAC
// fingerprint from docs/ARCHITECTURE.md §5: catching the same identity
// registering twice without ever decrypting a stored PAN to compare. A
// second SUBMITTED KYC with the same fingerprint is not blocked here; it
// surfaces to whoever reviews it next, same as any other submission.
export async function reviewKyc(
  kycId: string,
  decision: KycReviewDecision,
  reviewerUserId: string,
  rejectionReason?: string
): Promise<typeof affiliateKyc.$inferSelect> {
  const [kyc] = await db.select().from(affiliateKyc).where(eq(affiliateKyc.id, kycId));
  if (!kyc) throw new Error(`No such KYC submission: ${kycId}`);
  if (kyc.status !== 'SUBMITTED') {
    throw new Error(`KYC ${kycId} is not pending review (status: ${kyc.status})`);
  }

  const [affiliate] = await db.select().from(affiliates).where(eq(affiliates.id, kyc.affiliateId));
  if (!affiliate) throw new Error(`No such affiliate: ${kyc.affiliateId}`);
  if (affiliate.status !== 'KYC_SUBMITTED') {
    throw new InvalidTransitionError(affiliate.status, 'KYC_REJECTED/FEE_PENDING/ACTIVE');
  }

  if (decision === 'REJECTED') {
    const [updated] = await db
      .update(affiliateKyc)
      .set({ status: 'REJECTED', reviewedByUserId: reviewerUserId, reviewedAt: new Date(), rejectionReason })
      .where(eq(affiliateKyc.id, kycId))
      .returning();
    if (!updated) throw new Error('Update did not return a row');
    await transitionAffiliateStatus(affiliate.id, 'KYC_REJECTED');
    return updated;
  }

  const [duplicate] = await db
    .select()
    .from(affiliateKyc)
    .where(
      and(
        eq(affiliateKyc.panFingerprint, kyc.panFingerprint),
        eq(affiliateKyc.status, 'APPROVED'),
        ne(affiliateKyc.affiliateId, kyc.affiliateId)
      )
    );
  if (duplicate) throw new DuplicatePanError();

  const [updated] = await db
    .update(affiliateKyc)
    .set({ status: 'APPROVED', reviewedByUserId: reviewerUserId, reviewedAt: new Date() })
    .where(eq(affiliateKyc.id, kycId))
    .returning();
  if (!updated) throw new Error('Update did not return a row');

  const policy = await getCurrentCommissionPolicy();
  if (policy.registrationFeeEnabled === 'true') {
    await transitionAffiliateStatus(affiliate.id, 'FEE_PENDING');
  } else {
    await transitionAffiliateStatus(affiliate.id, 'ACTIVE', { activatedAt: new Date() });
  }

  return updated;
}

// Never returns the decrypted PAN/bank number over the wire in a list/detail
// view by default — callers that genuinely need the plaintext (none do yet
// in this phase) must call decryptPii explicitly and be reviewed for why.
export function redactedKycView(kyc: typeof affiliateKyc.$inferSelect) {
  return {
    id: kyc.id,
    affiliateId: kyc.affiliateId,
    panLast4: kyc.panLast4,
    status: kyc.status,
    rejectionReason: kyc.rejectionReason,
    createdAt: kyc.createdAt,
    reviewedAt: kyc.reviewedAt,
  };
}

// Exported only for the one legitimate internal use case (decrypting to
// re-display to the affiliate who owns the data, or an authorized manual
// review) — never wire this straight into a generic "get KYC" API response.
export { decryptPii };
