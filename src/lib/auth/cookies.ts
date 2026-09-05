import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';

export const SESSION_COOKIE_NAME = 'ge_session';

// `secure` is keyed off APP_ENV, deliberately NOT `process.env.NODE_ENV`.
// `npm start` runs Next in production mode even when you're serving it over
// plain http on localhost — keying this off NODE_ENV silently drops the
// cookie in that setup and login looks broken with no error anywhere
// (docs/ARCHITECTURE.md §15, mistake #3 this build actually made).
export async function setSessionCookie(token: string, absoluteExpiresAt: Date): Promise<void> {
  const env = getEnv();
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.APP_ENV !== 'development',
    sameSite: 'lax',
    path: '/',
    expires: absoluteExpiresAt,
  });
}

export async function getSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
