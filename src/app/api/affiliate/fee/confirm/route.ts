import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { payments } from '@/db/schema';
import { requireActor } from '@/lib/auth/actor';
import { getAffiliateByUserId } from '@/lib/affiliate/lookup';
import { confirmAffiliateFeePayment } from '@/lib/affiliate/fee';
import { feeConfirmSchema } from '@/lib/affiliate/schemas';
import { logAudit } from '@/lib/auth/audit';

export async function POST(request: Request) {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  const affiliate = await getAffiliateByUserId(actor.user.id);
  if (!affiliate) {
    return Response.json({ error: 'Not registered as an affiliate' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = feeConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Ownership check before doing anything else — a payment that isn't
  // yours returns 404, not 403 (docs/ARCHITECTURE.md rule 14), so this
  // endpoint can't be used to probe for the existence of other affiliates'
  // payment ids.
  const [payment] = await db.select().from(payments).where(eq(payments.id, parsed.data.paymentId));
  if (!payment || payment.affiliateId !== affiliate.id) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const updated = await confirmAffiliateFeePayment(parsed.data.paymentId, parsed.data.gatewayPaymentId);
  await logAudit({
    actorUserId: actor.user.id,
    action: 'affiliate.fee.confirm',
    outcome: 'ALLOWED',
    targetType: 'payment',
    targetId: updated.id,
    metadata: { status: updated.status },
  });

  return Response.json({ status: updated.status });
}
