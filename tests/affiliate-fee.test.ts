import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { affiliates, payments } from '@/db/schema';
import {
  initiateAffiliateFeePayment,
  confirmAffiliateFeePayment,
  InvalidStateForFeePaymentError,
} from '@/lib/affiliate/fee';
import { getCurrentCommissionPolicy } from '@/lib/affiliate/commission-policy';
import { getPaymentGateway, MockPaymentGateway } from '@/lib/payments';
import { createTestAffiliate, deleteTestUser } from './helpers';

const createdUserIds: string[] = [];

afterEach(async () => {
  while (createdUserIds.length) {
    const id = createdUserIds.pop();
    if (id) await deleteTestUser(id);
  }
});

function mockGateway(): MockPaymentGateway {
  const gateway = getPaymentGateway();
  if (!(gateway instanceof MockPaymentGateway)) {
    throw new Error('Expected PAYMENT_PROVIDER=mock for this test run');
  }
  return gateway;
}

describe('affiliate fee payment', () => {
  it('refuses to initiate a fee payment unless the affiliate is FEE_PENDING', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'KYC_PENDING' });
    createdUserIds.push(user.id);

    await expect(initiateAffiliateFeePayment(affiliate.id)).rejects.toThrow(InvalidStateForFeePaymentError);
  });

  it('reads the fee amount from the current server-side policy, not from any caller input', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'FEE_PENDING' });
    createdUserIds.push(user.id);

    const policy = await getCurrentCommissionPolicy();
    const { payment } = await initiateAffiliateFeePayment(affiliate.id);

    expect(payment.amountPaise).toBe(policy.registrationFeePaise);
    expect(payment.purpose).toBe('AFFILIATE_FEE');
    expect(payment.status).toBe('CREATED');
  });

  it('a genuinely captured payment activates the affiliate', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'FEE_PENDING' });
    createdUserIds.push(user.id);

    const { payment, gatewayOrderId } = await initiateAffiliateFeePayment(affiliate.id);
    const { gatewayPaymentId } = await mockGateway().simulateCapture(gatewayOrderId);

    const updated = await confirmAffiliateFeePayment(payment.id, gatewayPaymentId);
    expect(updated.status).toBe('CAPTURED');

    const [affiliateRow] = await db.select().from(affiliates).where(eq(affiliates.id, affiliate.id));
    expect(affiliateRow?.status).toBe('ACTIVE');
    expect(affiliateRow?.activatedAt).not.toBeNull();
  });

  // The direct regression test for mistake #7 (docs/ARCHITECTURE.md §19):
  // confirming a payment that the gateway reports as failed must NOT
  // activate the affiliate, no matter how "confirm" is called. If the
  // activation step ever goes back to trusting the payment id without
  // re-reading and checking its actual status, this fails.
  it('a failed payment does NOT activate the affiliate, even though confirm was called', async () => {
    const { user, affiliate } = await createTestAffiliate({ status: 'FEE_PENDING' });
    createdUserIds.push(user.id);

    const { payment, gatewayOrderId } = await initiateAffiliateFeePayment(affiliate.id);
    const { gatewayPaymentId } = await mockGateway().simulateFailure(gatewayOrderId);

    const updated = await confirmAffiliateFeePayment(payment.id, gatewayPaymentId);
    expect(updated.status).toBe('FAILED');

    const [affiliateRow] = await db.select().from(affiliates).where(eq(affiliates.id, affiliate.id));
    expect(affiliateRow?.status).toBe('FEE_PENDING');
    expect(affiliateRow?.activatedAt).toBeNull();

    const [paymentRow] = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(paymentRow?.status).toBe('FAILED');
  });
});
