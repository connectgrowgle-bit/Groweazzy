// Shared between tests/setup.ts (the vitest process's own env, used by
// direct library calls) and tests/global-setup.ts (the separately spawned
// `next start` server's env, used by HTTP-level tests). These MUST be
// identical literal values across both processes: a test like
// tests/attribution-routes.test.ts signs a cookie inside the server process
// and verifies it by calling verifyAttributionCookie() directly in the
// vitest process — if SESSION_SECRET differs between the two, the HMAC
// simply won't match and every such cross-process check fails, looking
// exactly like a real signing bug until you notice the two processes never
// agreed on a key to begin with.
export const SHARED_TEST_ENV = {
  SESSION_SECRET: 'test-only-session-secret-shared-across-both-test-processes',
  PII_ENCRYPTION_KEY: '0'.repeat(64), // 32 bytes hex, as src/lib/env.ts requires
  CRON_SECRET: 'test-only-cron-secret',
  // Set even though PAYMENT_PROVIDER=mock in tests (so env.ts's
  // razorpay-only cross-checks don't apply) — the webhook route verifies
  // signatures against this regardless of which gateway is "active" for
  // outbound calls, so tests/razorpay-webhook.test.ts needs a real value
  // to sign against.
  RAZORPAY_WEBHOOK_SECRET: 'test-only-razorpay-webhook-secret',
};

// Deliberately NOT here, unlike everything above: TRUSTED_PROXY_HEADER
// (src/lib/net.ts) has no cross-process cryptographic agreement to keep —
// nothing signs with it — so there's no correctness reason to force it
// identical on both sides. tests/setup.ts sets it (so a direct,
// in-process call to getClientIp() in a unit test, e.g. tests/net.test.ts,
// exercises the real "configured" code path) but tests/global-setup.ts's
// spawned server deliberately does NOT: this sandbox's loopback HTTP
// connections arrive with `x-forwarded-for: 127.0.0.1` already populated
// (apparently stamped by something upstream of Node here, not sent by the
// test client), so configuring the SAME header name as trusted on the
// live test server would make every HTTP-level test's request look like
// it came from one shared "client" — collapsing dozens of unrelated
// tests' registrations onto one IP-keyed rate-limit bucket and failing
// them with 429s that have nothing to do with what each test is actually
// checking. A real deployment's operator points TRUSTED_PROXY_HEADER at
// whatever header THEIR actual reverse proxy sets — this is a sandbox
// quirk of testing without one, not a reason to weaken the setting itself.

