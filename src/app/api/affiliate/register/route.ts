import { requireActor } from '@/lib/auth/actor';
import { registerAffiliate, AlreadyAffiliateError } from '@/lib/affiliate/register';
import { logAudit } from '@/lib/auth/audit';

export async function POST() {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  try {
    const affiliate = await registerAffiliate(actor.user.id);
    await logAudit({ actorUserId: actor.user.id, action: 'affiliate.register', outcome: 'ALLOWED' });
    return Response.json(
      { id: affiliate.id, status: affiliate.status, referralCode: affiliate.referralCode },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof AlreadyAffiliateError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
