import { z } from 'zod';
import { requirePermission } from '@/lib/auth/actor';
import { NoSuchRowError, updateModule } from '@/lib/training/authoring';

const schema = z.object({ title: z.string().min(1).max(200).optional(), orderIndex: z.number().int().optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePermission('training.course.author');
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const updated = await updateModule(id, parsed.data);
    return Response.json(updated);
  } catch (err) {
    if (err instanceof NoSuchRowError) return Response.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
