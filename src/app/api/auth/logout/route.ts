import { getSessionCookie, clearSessionCookie } from '@/lib/auth/cookies';
import { validateSessionToken, revokeSession } from '@/lib/auth/session';

export async function POST() {
  const token = await getSessionCookie();
  if (token) {
    const validated = await validateSessionToken(token);
    if (validated) {
      await revokeSession(validated.session.id, 'LOGOUT');
    }
  }
  await clearSessionCookie();
  return Response.json({ ok: true });
}
