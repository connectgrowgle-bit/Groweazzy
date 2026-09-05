import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { requirePermission } from '@/lib/auth/actor';
import { InvalidOrderTransitionError, transitionOrderStage } from '@/lib/orders/lifecycle';
import { logAudit } from '@/lib/auth/audit';

const ORDER_STAGES = [
  'AWAITING_PAYMENT',
  'PAID',
  'ONBOARDING',
  'MEETING_SCHEDULED',
  'REQUIREMENTS_LOCKED',
  'TEAM_ASSIGNED',
  'IN_PROGRESS',
  'REVIEW',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
] as const;

const schema = z.object({ toStage: z.enum(ORDER_STAGES) });

// A generic staff tool for the fulfillment stages Phase 6 didn't give a
// dedicated named action to (TEAM_ASSIGNED -> IN_PROGRESS -> REVIEW ->
// DELIVERED -> COMPLETED) — meeting-scheduling and requirements-locking
// keep their own specific endpoints (POST /api/orders/[id]/meeting,
// /lock-requirements) because those carry side effects and preconditions
// beyond a plain stage move; this one is a plain move, gated on the same
// order.update_stage permission and validated by
// transitionOrderStage's own ALLOWED_TRANSITIONS map. Introduced now so the
// CRM's self-population (docs/ARCHITECTURE.md §9, §23) has a real,
// in-app way to be exercised end to end — a proper staff/admin ops screen
// around this is Phase 9's job.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('order.update_stage');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) return Response.json({ error: 'Not found' }, { status: 404 });

  try {
    const updated = await transitionOrderStage(id, parsed.data.toStage, { actorUserId: actor.user.id });
    await logAudit({
      actorUserId: actor.user.id,
      action: 'order.advance',
      outcome: 'ALLOWED',
      targetType: 'order',
      targetId: id,
      metadata: { toStage: parsed.data.toStage },
    });
    return Response.json({ stage: updated.stage });
  } catch (err) {
    if (err instanceof InvalidOrderTransitionError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
