import { getEnv } from '@/lib/env';

// Every client-supplied header claiming an IP (`x-forwarded-for` and
// friends) is trivially spoofable UNLESS there is a real reverse proxy in
// front of this app that overwrites it before the request reaches Node —
// and whether that's true depends entirely on the deployment, which is
// exactly why TRUSTED_PROXY_HEADER (src/lib/env.ts) exists as an operator
// setting rather than a hardcoded header name.
//
// With no trusted proxy configured, this returns null rather than falling
// back to reading (and trusting) `x-forwarded-for` anyway — a null IP
// making IP-based rate limiting a no-op is an honest, visible limitation;
// silently trusting an attacker-controlled header would make the limit
// look like it's working while being trivially bypassable by rotating the
// header value on every request (docs/ARCHITECTURE.md §27).
export function getClientIp(request: Request): string | null {
  const env = getEnv();
  if (!env.TRUSTED_PROXY_HEADER) return null;

  const value = request.headers.get(env.TRUSTED_PROXY_HEADER);
  if (!value) return null;

  // x-forwarded-for can carry a comma-separated hop chain
  // ("client, proxy1, proxy2") appended to by every intermediate proxy —
  // the FIRST entry is the original client as seen by the first (trusted)
  // proxy hop, which is what a trusted single-reverse-proxy setup expects.
  return value.split(',')[0]?.trim() || null;
}
