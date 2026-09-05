import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { meetings, orders } from '@/db/schema';
import { transitionOrderStage } from './lifecycle';

// Scheduling a meeting is what moves an order out of ONBOARDING — but only
// the FIRST time: rescheduling, or adding a follow-up meeting on an order
// already at MEETING_SCHEDULED (or further along, if it was kicked back to
// ONBOARDING and rescheduled from there), is just another row in this
// table, not a lifecycle event to repeat. Same "only acts on the specific
// state it's meant for" shape as handleServiceOrderPaymentCaptured
// (src/lib/payments/order-webhooks.ts) — never a raw column write either
// way, when it does apply.
export async function scheduleMeeting(
  orderId: string,
  params: { scheduledAt: Date; meetingLink?: string; scheduledByUserId?: string }
): Promise<typeof meetings.$inferSelect> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error(`No such order: ${orderId}`);

  const [meeting] = await db
    .insert(meetings)
    .values({
      orderId,
      scheduledAt: params.scheduledAt,
      meetingLink: params.meetingLink,
      scheduledByUserId: params.scheduledByUserId,
    })
    .returning();
  if (!meeting) throw new Error('Insert did not return a row');

  if (order.stage === 'ONBOARDING') {
    await transitionOrderStage(orderId, 'MEETING_SCHEDULED', {
      actorUserId: params.scheduledByUserId,
      note: 'Meeting scheduled',
    });
  }

  return meeting;
}
