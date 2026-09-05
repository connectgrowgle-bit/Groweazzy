import { requireActor } from '@/lib/auth/actor';
import { getAffiliateByUserId } from '@/lib/affiliate/lookup';

export async function GET() {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  const affiliate = await getAffiliateByUserId(actor.user.id);
  if (!affiliate) {
    return Response.json({ error: 'Not registered as an affiliate' }, { status: 404 });
  }

  // No PII (bank details, PAN) in this response — those never round-trip
  // to the client past what's needed to display last-4 (Phase 9 concern
  // for now; this endpoint doesn't need them at all).
  return Response.json({
    id: affiliate.id,
    status: affiliate.status,
    referralCode: affiliate.referralCode,
    bankAccountLast4: affiliate.bankAccountLast4,
    activatedAt: affiliate.activatedAt,
    suspendedAt: affiliate.suspendedAt,
    terminatedAt: affiliate.terminatedAt,
  });
}
