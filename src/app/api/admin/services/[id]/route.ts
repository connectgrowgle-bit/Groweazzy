import { z } from 'zod';
import { requirePermission } from '@/lib/auth/actor';
import { getServiceForAdmin, NoSuchRowError, updateServiceCopy } from '@/lib/catalogue-admin';

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  tagline: z.string().max(500).optional(),
  audience: z.string().max(200).optional(),
  shortDescription: z.string().min(1).max(2000).optional(),
  longDescriptionHtml: z.string().min(1).optional(),
  features: z.array(z.string().min(1)).optional(),
  howItWorks: z.array(z.string().min(1)).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('service.view');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const detail = await getServiceForAdmin(id);
  if (!detail) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(detail);
}

// service.edit — copy fields only. isActive is included here (taking a
// service out of the public catalogue is a content decision, not a
// pricing one) but pricePaise never is — that's exclusively
// PATCH /api/admin/plans/[id] (service.pricing).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('service.edit');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const updated = await updateServiceCopy(id, parsed.data);
    return Response.json(updated);
  } catch (err) {
    if (err instanceof NoSuchRowError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
