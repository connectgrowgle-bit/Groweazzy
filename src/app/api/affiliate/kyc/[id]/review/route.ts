import { requirePermission } from '@/lib/auth/actor';
import { reviewKyc, DuplicatePanError } from '@/lib/affiliate/kyc';
import { kycReviewSchema } from '@/lib/affiliate/schemas';
import { logAudit } from '@/lib/auth/audit';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('affiliate.kyc.review');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = kycReviewSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const kyc = await reviewKyc(id, parsed.data.decision, actor.user.id, parsed.data.rejectionReason);
    await logAudit({
      actorUserId: actor.user.id,
      action: 'affiliate.kyc.review',
      outcome: 'ALLOWED',
      targetType: 'affiliate_kyc',
      targetId: id,
      metadata: { decision: parsed.data.decision },
    });
    return Response.json({ id: kyc.id, status: kyc.status });
  } catch (err) {
    if (err instanceof DuplicatePanError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof Error && err.message.startsWith('No such KYC submission')) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    throw err;
  }
}
