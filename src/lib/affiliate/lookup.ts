import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliates } from '@/db/schema';

export async function getAffiliateByUserId(userId: string): Promise<typeof affiliates.$inferSelect | null> {
  const [row] = await db.select().from(affiliates).where(eq(affiliates.userId, userId));
  return row ?? null;
}

export async function getAffiliateById(affiliateId: string): Promise<typeof affiliates.$inferSelect | null> {
  const [row] = await db.select().from(affiliates).where(eq(affiliates.id, affiliateId));
  return row ?? null;
}
