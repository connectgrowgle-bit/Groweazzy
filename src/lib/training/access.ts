import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliates } from '@/db/schema';
import { can } from '@/lib/auth/rbac';

// Who can see PUBLISHED training content at all (docs/ARCHITECTURE.md §10,
// §25). The affiliate FAQ (src/lib/repository.ts, "affiliate-fee-why") is
// explicit about what the ₹2,000 registration fee buys: "the training and
// onboarding materials that come with joining as an affiliate" — so the
// training portal's audience is ACTIVE affiliates, not customers or the
// general public. Staff with training.course.author can also see it
// (they need to view what they're authoring/reviewing exactly as a learner
// would, including checking what's actually published), independent of
// whether they happen to also be an affiliate.
export async function canAccessTraining(userId: string): Promise<boolean> {
  if (await can(userId, 'training.course.author')) return true;

  const [affiliate] = await db.select().from(affiliates).where(eq(affiliates.userId, userId));
  return affiliate?.status === 'ACTIVE';
}
