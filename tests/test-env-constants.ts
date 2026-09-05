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
};
