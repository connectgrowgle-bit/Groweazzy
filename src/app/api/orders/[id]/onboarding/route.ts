import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { requireActor } from '@/lib/auth/actor';
import { RequirementsLockedError, saveOnboardingDraft, submitOnboarding } from '@/lib/orders/onboarding';
import { UnknownOnboardingServiceError } from '@/lib/onboarding-schemas';

// Onboarding is the client's own brief — writes here are owner-only (not
// gated on order.view_all/order.update_stage), same ownership-first,
// 404-not-403 shape as every other per-order endpoint.
async function loadOwnedOrder(orderId: string, userId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || order.userId !== userId) return null;
  return order;
}

function onboardingErrorResponse(err: unknown): Response {
  if (err instanceof RequirementsLockedError) {
    return Response.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof UnknownOnboardingServiceError) {
    // A gap in our own onboarding-schemas.ts coverage, not something the
    // client did wrong.
    return Response.json({ error: 'Onboarding is not configured for this service yet' }, { status: 500 });
  }
  if (err instanceof ZodError) {
    return Response.json({ error: err.flatten() }, { status: 400 });
  }
  throw err;
}

// Save (or overwrite) the draft — everything optional, "come back later"
// (docs/ARCHITECTURE.md §8).
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const order = await loadOwnedOrder(id, actor.user.id);
  if (!order) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  try {
    const row = await saveOnboardingDraft(id, body);
    return Response.json({ isDraft: row.isDraft === 'true', updatedAt: row.updatedAt });
  } catch (err) {
    return onboardingErrorResponse(err);
  }
}

// Submits the real, complete brief — does NOT lock requirements (that's
// the separate POST /api/orders/[id]/lock-requirements action).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  if (actor instanceof Response) return actor;

  const { id } = await params;
  const order = await loadOwnedOrder(id, actor.user.id);
  if (!order) return Response.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  try {
    const row = await submitOnboarding(id, body);
    return Response.json({ isDraft: row.isDraft === 'true', submittedAt: row.submittedAt });
  } catch (err) {
    return onboardingErrorResponse(err);
  }
}
