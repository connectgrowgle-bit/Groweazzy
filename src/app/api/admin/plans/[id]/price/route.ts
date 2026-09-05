import { z } from 'zod';
import { requirePermission } from '@/lib/auth/actor';
import { getServicePlanPriceHistory, NoSuchRowError, updateServicePlanPrice } from '@/lib/catalogue-admin';
import { logAudit } from '@/lib/auth/audit';

const schema = z.object({ pricePaise: z.number().int().positive(), reason: z.string().min(1).max(1000) });

// "Every price change requires a reason and writes a
// service_plan_price_history row in the same transaction as the price
// update" (docs/ARCHITECTURE.md §11) — the reason is required at the
// schema level (not optional), so there is no code path that changes a
// price without one.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('service.pricing');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const updated = await updateServicePlanPrice(id, parsed.data.pricePaise, parsed.data.reason, actor.user.id);
    await logAudit({
      actorUserId: actor.user.id,
      action: 'service.plan.price_change',
      outcome: 'ALLOWED',
      targetType: 'service_plan',
      targetId: id,
      metadata: { newPricePaise: parsed.data.pricePaise, reason: parsed.data.reason },
    });
    return Response.json(updated);
  } catch (err) {
    if (err instanceof NoSuchRowError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('service.pricing');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const history = await getServicePlanPriceHistory(id);
  return Response.json({ history });
}
