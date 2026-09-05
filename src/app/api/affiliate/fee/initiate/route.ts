import { requireActor } from '@/lib/auth/actor';
import { getAffiliateByUserId } from '@/lib/affiliate/lookup';
import { initiateAffiliateFeePayment, InvalidStateForFeePaymentError } from '@/lib/affiliate/fee';

export async function POST() {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  const affiliate = await getAffiliateByUserId(actor.user.id);
  if (!affiliate) {
    return Response.json({ error: 'Not registered as an affiliate' }, { status: 404 });
  }

  try {
    const { payment, gatewayOrderId } = await initiateAffiliateFeePayment(affiliate.id);
    return Response.json(
      { paymentId: payment.id, gatewayOrderId, amountPaise: payment.amountPaise },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof InvalidStateForFeePaymentError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
