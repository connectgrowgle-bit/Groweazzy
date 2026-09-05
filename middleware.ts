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
// Kept in sync by hand, not derived — a stale entry here is a UX
// regression (one extra render before a page's own getActor() redirect
// fires), never a security one, since that per-page check is the actual
// boundary regardless of what's listed here (docs/ARCHITECTURE.md §27).
// `/checkout` is deliberately NOT here: its own page sends an anonymous
// visitor to /register (carrying `plan` through registration), not
// /login — this middleware only knows how to redirect to /login, which
// would race and override that more specific, intentional destination.
const PROTECTED_PREFIXES = ['/account', '/affiliate/dashboard', '/orders', '/crm', '/training', '/admin'];

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // Attribution (docs/ARCHITECTURE.md §6): `?ref=CODE` must work on any
  // public URL, e.g. `/ai-content-avatar?ref=GEA10245`. Middleware itself
  // never touches the database — it only detects the param and hands off
  // to a Node route (/api/attribution/click, excluded from this
  // middleware's matcher below) that records the click and sets a signed
  // cookie, then redirects to the SAME url with `ref` stripped. That
  // stripping is what makes a refresh not a second click, and what stops a
  // shared (post-redirect) link from re-attributing to whoever it's shared
  // with next — the clean URL simply carries no ref param to act on.
  const ref = searchParams.get('ref');
  if (ref) {
    const cleanUrl = new URL(request.nextUrl);
    cleanUrl.searchParams.delete('ref');

    const clickUrl = new URL('/api/attribution/click', request.url);
    clickUrl.searchParams.set('ref', ref);
    clickUrl.searchParams.set('next', cleanUrl.pathname + cleanUrl.search);
    return NextResponse.redirect(clickUrl);
  }

  // Exact segment match only — plain `pathname.startsWith(prefix)` would
  // also sweep up an unrelated public page whose slug merely starts with
  // the same characters (e.g. a catalogue service slugged
  // "admin-live-test", rendered by the public `/[slug]` route, must not
  // be treated as living under `/admin` just because the string happens
  // to start the same way — found by tests/admin-routes.test.ts during
  // the Phase 10 security audit).
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (isProtected) {
    const hasCookie = request.cookies.has(SESSION_COOKIE_NAME);
    if (!hasCookie) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Runs on every page request except static assets and API routes — the
  // attribution param has to work anywhere, and excluding /api/ here is
  // what stops this from re-processing its own redirect to
  // /api/attribution/click as a loop.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
