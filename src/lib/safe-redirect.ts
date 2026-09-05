// A `next` query param is only safe to client-side-navigate to when it's a
// same-origin, absolute path — `next.startsWith('/')` alone is NOT
// enough: "//evil.com" and "/\evil.com" both satisfy it while being
// protocol-relative URLs that browsers resolve to a DIFFERENT origin (an
// open redirect straight out of a login/register flow, docs/ARCHITECTURE.md
// §27). Reject both forms explicitly rather than trusting a single
// startsWith check.
export function safeInternalPath(next: string | undefined | null, fallback: string): string {
  if (!next) return fallback;
  if (!next.startsWith('/')) return fallback;
  if (next.startsWith('//') || next.startsWith('/\\')) return fallback;
  return next;
}
