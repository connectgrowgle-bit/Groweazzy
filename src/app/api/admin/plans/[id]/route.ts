import { z } from 'zod';
import { requirePermission } from '@/lib/auth/actor';
import { NoSuchRowError, updateServicePlanDetails } from '@/lib/catalogue-admin';

const schema = z.object({
  name: z.string().min(1).max(200).optional(),
  billingNote: z.string().max(100).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

// service.pricing — non-price plan details (name, billing note,
// activation). Price itself is exclusively PATCH .../price, which
// requires a reason and writes history.
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
    const updated = await updateServicePlanDetails(id, parsed.data);
    return Response.json(updated);
  } catch (err) {
    if (err instanceof NoSuchRowError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
