import { z } from 'zod';
import { requirePermission } from '@/lib/auth/actor';
import { createService, listServicesForAdmin } from '@/lib/catalogue-admin';
import { isUniqueViolation } from '@/lib/db-errors';

const createSchema = z.object({
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  tagline: z.string().max(500).optional(),
  audience: z.string().max(200).optional(),
  shortDescription: z.string().min(1).max(2000),
  longDescriptionHtml: z.string().min(1),
  features: z.array(z.string().min(1)).optional(),
  howItWorks: z.array(z.string().min(1)).optional(),
});

// service.view — the admin listing (every service regardless of isActive),
// distinct from the public, active-only src/lib/repository.ts#getServices.
export async function GET() {
  const actor = await requirePermission('service.view');
  if (actor instanceof Response) return actor;

  const services = await listServicesForAdmin();
  return Response.json({ services });
}

// service.edit — creating a whole new service is still a copy/content
// action, not a pricing one; its first plan is added separately via
// POST /api/admin/services/[id]/plans (service.pricing).
export async function POST(request: Request) {
  const actor = await requirePermission('service.edit');
  if (actor instanceof Response) return actor;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const service = await createService(parsed.data);
    return Response.json(service, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err, 'services_slug_uidx')) {
      return Response.json({ error: 'A service with this slug already exists' }, { status: 409 });
    }
    throw err;
  }
}
