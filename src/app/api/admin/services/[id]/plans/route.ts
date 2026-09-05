import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { services } from '@/db/schema';
import { requirePermission } from '@/lib/auth/actor';
import { createServicePlan } from '@/lib/catalogue-admin';
import { isUniqueViolation } from '@/lib/db-errors';

const schema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'key must be lowercase letters, digits and hyphens only'),
  name: z.string().min(1).max(200),
  pricePaise: z.number().int().positive(),
  billingNote: z.string().max(100).optional(),
});

// service.pricing — a brand-new plan has no prior price to record a
// change against, so this writes no service_plan_price_history row
// (docs/ARCHITECTURE.md §11/§26); only PATCH /api/admin/plans/[id]/price
// does that.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('service.pricing');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const [service] = await db.select().from(services).where(eq(services.id, id));
  if (!service) return Response.json({ error: 'No such service' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const plan = await createServicePlan({ serviceId: id, ...parsed.data });
    return Response.json(plan, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err, 'service_plans_key_uidx')) {
      return Response.json({ error: 'A plan with this key already exists' }, { status: 409 });
    }
    if (isUniqueViolation(err, 'service_plans_service_name_uidx')) {
      return Response.json({ error: 'This service already has a plan with this name' }, { status: 409 });
    }
    throw err;
  }
}
