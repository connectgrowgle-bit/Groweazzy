import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { onboardingSubmissions, orders } from '@/db/schema';
import { transitionOrderStage } from './lifecycle';

export class OnboardingNotSubmittedError extends Error {
  constructor(orderId: string) {
    super(`Order ${orderId} has no submitted onboarding brief to lock`);
    this.name = 'OnboardingNotSubmittedError';
  }
}

// The explicit, one-way action docs/ARCHITECTURE.md §8 calls out by name:
// submitting the onboarding brief does NOT lock requirements on its own,
// and there is no transition back out of REQUIREMENTS_LOCKED once this
// runs — enforced by transitionOrderStage's own ALLOWED_TRANSITIONS map
// (src/lib/orders/lifecycle.ts), not repeated here.
//
// Refuses to lock a brief that was only ever saved as a draft: "locked" is
// a promise that what's on file is the real, complete requirement set, not
// a half-finished form someone forgot to submit.
export async function lockRequirements(
  orderId: string,
  actorUserId?: string
): Promise<typeof orders.$inferSelect> {
  const [submission] = await db
    .select()
    .from(onboardingSubmissions)
    .where(eq(onboardingSubmissions.orderId, orderId));
  if (!submission || submission.isDraft === 'true') {
    throw new OnboardingNotSubmittedError(orderId);
  }

  return transitionOrderStage(orderId, 'REQUIREMENTS_LOCKED', {
    actorUserId,
    note: 'Requirements locked',
    extraFields: { requirementsLockedAt: new Date() },
  });
}
