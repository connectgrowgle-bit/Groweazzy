import { getSessionCookie } from './cookies';
import { touchSession, validateSessionToken, type ValidatedSession } from './session';
import { can } from './rbac';
import { logAudit } from './audit';
import type { PermissionKey } from './permissions-catalog';

// The one function every page and API route resolves identity through.
// Middleware (middleware.ts) may redirect unauthenticated requests away
// from a route as a UX shortcut, but it is NOT the security boundary —
// deleting middleware.ts must not make anything more accessible, because
// every route calls this itself (docs/ARCHITECTURE.md §4, rule 11).
//
// MFA note: full TOTP enrollment/verification ships in Phase 12, but the
// gate lives here now so no route added between now and then needs
// retrofitting. Today `user.mfaEnabled` is always false, so this is inert.
export async function getActor(): Promise<ValidatedSession | null> {
  const token = await getSessionCookie();
  if (!token) return null;

  const result = await validateSessionToken(token);
  if (!result) return null;

  if (result.user.mfaEnabled && !result.session.mfaVerifiedAt) {
    // A session that hasn't answered its MFA challenge is refused exactly
    // like an expired one — not partially trusted.
    return null;
  }

  // Extend the sliding window on genuine, successfully-authenticated
  // activity only — never on a request that failed validation above.
  await touchSession(result.session.id);

  return result;
}

// Convenience for API routes: returns the actor, or a ready-to-return 401
// Response. Usage: `const actor = await requireActor(); if (actor instanceof
// Response) return actor;`
export async function requireActor(): Promise<ValidatedSession | Response> {
  const actor = await getActor();
  if (!actor) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return actor;
}

// Same shape, additionally requiring a permission. Logs both outcomes —
// see docs/ARCHITECTURE.md rule 16.
export async function requirePermission(permission: PermissionKey): Promise<ValidatedSession | Response> {
  const actor = await getActor();
  if (!actor) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const allowed = await can(actor.user.id, permission);
  await logAudit({
    actorUserId: actor.user.id,
    action: permission,
    outcome: allowed ? 'ALLOWED' : 'DENIED',
  });

  if (!allowed) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  return actor;
}
