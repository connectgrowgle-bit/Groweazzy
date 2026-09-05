import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/cookies';

// Middleware is NOT the security boundary (docs/ARCHITECTURE.md §4, rule 11).
// It runs on the Edge runtime with no database connection, so it can only
// check whether a session cookie is *present* — never whether the session
// is valid, unrevoked, unexpired, or past the sessionsValidFrom watermark.
// That real check happens in getActor() (src/lib/auth/actor.ts), which
// every protected page and API route calls for itself. This middleware
// exists purely as a UX shortcut (skip rendering a page just to redirect
// it); deleting this file must not make anything more accessible — verify
// that by checking that every route under `PROTECTED_PREFIXES` also calls
// getActor()/requireActor()/requirePermission() server-side.
const PROTECTED_PREFIXES = ['/account', '/affiliate/dashboard'];

export function middleware(request: NextRequest) {
  const isProtected = PROTECTED_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix));
  if (!isProtected) return NextResponse.next();

  const hasCookie = request.cookies.has(SESSION_COOKIE_NAME);
  if (!hasCookie) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/account/:path*', '/affiliate/dashboard/:path*'],
};
