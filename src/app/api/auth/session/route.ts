import { getActor } from '@/lib/auth/actor';
import { getPermissionsForUser } from '@/lib/auth/rbac';

export async function GET() {
  const actor = await getActor();
  if (!actor) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await getPermissionsForUser(actor.user.id);

  return Response.json({
    user: {
      id: actor.user.id,
      email: actor.user.email,
      mfaEnabled: actor.user.mfaEnabled,
    },
    permissions,
  });
}
