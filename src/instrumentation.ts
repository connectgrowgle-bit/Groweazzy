// Next.js calls register() exactly once when the server starts, before any
// request is handled — the actual "refuse to boot on a mismatch" mechanism
// docs/ARCHITECTURE.md and src/lib/env.ts describe. getEnv() throws on
// invalid config; letting that throw escape here crashes the server at
// startup instead of silently serving requests with bad configuration
// (e.g. a test Razorpay key under PAYMENT_MODE=live).
//
// See https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getEnv } = await import('@/lib/env');
    getEnv();
  }
}
