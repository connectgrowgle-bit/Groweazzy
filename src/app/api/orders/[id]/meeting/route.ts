import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { requirePermission } from '@/lib/auth/actor';
import { scheduleMeeting } from '@/lib/orders/meetings';
import { logAudit } from '@/lib/auth/audit';

const schema = z.object({
  scheduledAt: z.string().datetime(),
  meetingLink: z.string().url().optional(),
});

// Staff-only: `meeting.schedule` (STAFF holds this by default — see
// src/lib/auth/permissions-catalog.ts).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('meeting.schedule');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) return Response.json({ error: 'Not found' }, { status: 404 });

  const meeting = await scheduleMeeting(id, {
    scheduledAt: new Date(parsed.data.scheduledAt),
    meetingLink: parsed.data.meetingLink,
    scheduledByUserId: actor.user.id,
  });

  await logAudit({
    actorUserId: actor.user.id,
    action: 'meeting.schedule',
    outcome: 'ALLOWED',
    targetType: 'order',
    targetId: id,
  });

  return Response.json(meeting, { status: 201 });
}
