import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliates } from '@/db/schema';
import { isUniqueViolation } from '@/lib/db-errors';
import { transitionAffiliateStatus } from './lifecycle';

function generateReferralCode(): string {
  // "GEA" + 5 digits, matching the docs/ARCHITECTURE.md example (GEA10245).
  const digits = randomInt(0, 100000).toString().padStart(5, '0');
  return `GEA${digits}`;
}

export class AlreadyAffiliateError extends Error {
  constructor() {
    super('This user is already registered as an affiliate');
    this.name = 'AlreadyAffiliateError';
  }
}

// Creates the affiliate row and immediately advances it past the
// conceptually-instantaneous REGISTERED state into KYC_PENDING — there is
// nothing else to do at REGISTERED, but persisting it (even briefly, within
// this same call) keeps the state machine's edges real rather than
// collapsing two named states into one because it was convenient.
export async function registerAffiliate(userId: string): Promise<typeof affiliates.$inferSelect> {
  const [existing] = await db.select().from(affiliates).where(eq(affiliates.userId, userId));
  if (existing) throw new AlreadyAffiliateError();

  // Referral codes are short and random — collisions are rare but possible;
  // retry on the unique index rather than pre-checking (pre-checking a
  // unique constraint is exactly the check-then-insert race the partial
  // unique indexes elsewhere in this schema exist to avoid trusting).
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const referralCode = generateReferralCode();
    try {
      const [affiliate] = await db.insert(affiliates).values({ userId, referralCode }).returning();
      if (!affiliate) throw new Error('Insert did not return a row');
      return transitionAffiliateStatus(affiliate.id, 'KYC_PENDING');
    } catch (err) {
      if (isUniqueViolation(err, 'affiliates_referral_code_uidx') && attempt < MAX_ATTEMPTS - 1) {
        continue;
      }
      if (isUniqueViolation(err, 'affiliates_user_uidx')) {
        throw new AlreadyAffiliateError();
      }
      throw err;
    }
  }
  throw new Error('Failed to generate a unique referral code after several attempts');
}
