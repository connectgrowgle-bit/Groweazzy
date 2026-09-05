import { requireActor } from '@/lib/auth/actor';
import { getAffiliateByUserId } from '@/lib/affiliate/lookup';
import { submitKyc, InvalidStateForKycError } from '@/lib/affiliate/kyc';
import { kycSubmitSchema } from '@/lib/affiliate/schemas';
import { logAudit } from '@/lib/auth/audit';

export async function POST(request: Request) {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  const affiliate = await getAffiliateByUserId(actor.user.id);
  if (!affiliate) {
    return Response.json({ error: 'Not registered as an affiliate' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = kycSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const kyc = await submitKyc(affiliate.id, parsed.data);
    await logAudit({
      actorUserId: actor.user.id,
      action: 'affiliate.kyc.submit',
      outcome: 'ALLOWED',
      targetType: 'affiliate',
      targetId: affiliate.id,
    });
    return Response.json({ id: kyc.id, status: kyc.status, panLast4: kyc.panLast4 }, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidStateForKycError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
