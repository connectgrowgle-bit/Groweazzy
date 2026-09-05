import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { meetings, onboardingSubmissions, orders, payments, servicePlans, services } from '@/db/schema';
import { requireActor } from '@/lib/auth/actor';
import { can } from '@/lib/auth/rbac';

// One order, with everything its workspace page needs to render: the
// service/plan it's for, its most recent payment's status, its onboarding
// submission (if any), and its scheduled meetings. A non-owner without
// order.view_all gets 404, not 403 — same enumeration-safety reasoning as
// every other ownership check in this codebase (docs/ARCHITECTURE.md rule
// 14) — so this endpoint can't be used to probe which order ids exist.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const [row] = await db
    .select({ order: orders, plan: servicePlans, service: services })
    .from(orders)
    .innerJoin(servicePlans, eq(servicePlans.id, orders.servicePlanId))
    .innerJoin(services, eq(services.id, servicePlans.serviceId))
    .where(eq(orders.id, id));

  if (!row) return Response.json({ error: 'Not found' }, { status: 404 });

  const isOwner = row.order.userId === actor.user.id;
  const [canViewAll, canUpdateStage, canScheduleMeeting, canCancelPerm] = await Promise.all([
    can(actor.user.id, 'order.view_all'),
    can(actor.user.id, 'order.update_stage'),
    can(actor.user.id, 'meeting.schedule'),
    can(actor.user.id, 'order.cancel'),
  ]);
  if (!isOwner && !canViewAll) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const [onboarding] = await db.select().from(onboardingSubmissions).where(eq(onboardingSubmissions.orderId, id));
  const meetingRows = await db.select().from(meetings).where(eq(meetings.orderId, id)).orderBy(desc(meetings.scheduledAt));
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, id))
    .orderBy(desc(payments.createdAt))
    .limit(1);

  return Response.json({
    order: row.order,
    service: { slug: row.service.slug, name: row.service.name },
    plan: { name: row.plan.name, pricePaise: row.plan.pricePaise },
    payment: payment ? { id: payment.id, status: payment.status, razorpayOrderId: payment.razorpayOrderId } : null,
    onboarding: onboarding
      ? { data: onboarding.data, isDraft: onboarding.isDraft === 'true', submittedAt: onboarding.submittedAt }
      : null,
    meetings: meetingRows,
    isOwner,
    permissions: {
      updateStage: canUpdateStage,
      scheduleMeeting: canScheduleMeeting,
      cancel: isOwner || canCancelPerm,
    },
  });
}
