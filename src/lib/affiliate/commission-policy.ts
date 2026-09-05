import { desc } from 'drizzle-orm';
import { db } from '@/db';
import { commissionPolicies } from '@/db/schema';

// The active policy is whichever row has the latest effectiveFrom — this
// keeps past commissions explainable even after a rate change
// (docs/ARCHITECTURE.md §13 D-3/D-5), rather than a single mutable row.
// Phase 9's admin dashboard is the real authoring UI; until then this
// bootstraps a first row from the schema's own column defaults so the
// affiliate fee flow has something to read without a manual seed step.
export async function getCurrentCommissionPolicy(): Promise<typeof commissionPolicies.$inferSelect> {
  const [latest] = await db
    .select()
    .from(commissionPolicies)
    .orderBy(desc(commissionPolicies.effectiveFrom))
    .limit(1);
  if (latest) return latest;

  const [created] = await db.insert(commissionPolicies).values({}).returning();
  if (!created) throw new Error('Failed to bootstrap a default commission policy');
  return created;
}
