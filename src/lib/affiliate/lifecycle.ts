import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliates } from '@/db/schema';

// The lifecycle from docs/ARCHITECTURE.md §5:
// REGISTERED → KYC_PENDING → KYC_SUBMITTED → (KYC_REJECTED | FEE_PENDING | ACTIVE)
//   KYC_REJECTED → KYC_PENDING (resubmission)
//   FEE_PENDING → ACTIVE
//   ACTIVE ⇄ SUSPENDED → TERMINATED
//
// KYC_SUBMITTED can go straight to ACTIVE, skipping FEE_PENDING, when the
// registration fee is disabled (docs/ARCHITECTURE.md D-2 — the fee must be
// switchable to ₹0/off entirely without a deploy). Which of FEE_PENDING or
// ACTIVE applies is decided by the caller (src/lib/affiliate/kyc.ts, which
// reads commissionPolicies) — this module only enforces that the edge is
// legal, not which one gets chosen.
//
// TERMINATED is terminal: no edge leaves it. This is enforced here, in one
// place, rather than trusted to every call site that might change status.
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  REGISTERED: ['KYC_PENDING'],
  KYC_PENDING: ['KYC_SUBMITTED'],
  KYC_SUBMITTED: ['KYC_REJECTED', 'FEE_PENDING', 'ACTIVE'],
  KYC_REJECTED: ['KYC_PENDING'],
  FEE_PENDING: ['ACTIVE'],
  ACTIVE: ['SUSPENDED', 'TERMINATED'],
  SUSPENDED: ['ACTIVE', 'TERMINATED'],
  TERMINATED: [],
};

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot transition affiliate status from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

// Applies a status transition inside a single transaction, locking the
// affiliate row (`for('update')`) before checking legality — two concurrent
// requests racing to transition the same affiliate must not both succeed
// into contradictory states (e.g. one approving KYC while another rejects
// it). The second request blocks until the first commits, then sees the
// already-updated status and is correctly rejected if its own transition is
// no longer legal from there.
export async function transitionAffiliateStatus(
  affiliateId: string,
  to: string,
  extraFields: Record<string, unknown> = {}
): Promise<typeof affiliates.$inferSelect> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(affiliates).where(eq(affiliates.id, affiliateId)).for('update');
    if (!current) throw new Error(`No such affiliate: ${affiliateId}`);

    const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(to)) {
      throw new InvalidTransitionError(current.status, to);
    }

    const [updated] = await tx
      .update(affiliates)
      .set({ status: to as typeof affiliates.$inferSelect.status, updatedAt: new Date(), ...extraFields })
      .where(eq(affiliates.id, affiliateId))
      .returning();
    if (!updated) throw new Error('Update did not return a row');
    return updated;
  });
}
