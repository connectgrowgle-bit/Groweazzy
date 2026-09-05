import { transitionAffiliateStatus } from './lifecycle';
import type { affiliates } from '@/db/schema';

export async function suspendAffiliate(affiliateId: string): Promise<typeof affiliates.$inferSelect> {
  return transitionAffiliateStatus(affiliateId, 'SUSPENDED', { suspendedAt: new Date() });
}

export async function reinstateAffiliate(affiliateId: string): Promise<typeof affiliates.$inferSelect> {
  return transitionAffiliateStatus(affiliateId, 'ACTIVE', { suspendedAt: null });
}

export async function terminateAffiliate(affiliateId: string): Promise<typeof affiliates.$inferSelect> {
  return transitionAffiliateStatus(affiliateId, 'TERMINATED', { terminatedAt: new Date() });
}
