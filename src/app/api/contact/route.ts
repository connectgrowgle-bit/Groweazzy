import { contactFormSchema } from '@/lib/contact-schema';
import { getEnv } from '@/lib/env';
import { checkRateLimit, rateLimitedResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/net';

// Phase 1 scope: validate and deliver via whatever EMAIL_PROVIDER is
// configured. EMAIL_PROVIDER=console (the dev default) just logs — wiring
// this to a real send (resend/ses) and to a crm_contacts row is Phase 7.
const IP_LIMIT = { maxAttempts: 5, windowSeconds: 60 * 60 };

export async function POST(request: Request) {
  const trustedIp = getClientIp(request);
  if (trustedIp) {
    const ipLimit = await checkRateLimit(`contact:ip:${trustedIp}`, IP_LIMIT);
    if (!ipLimit.allowed) return rateLimitedResponse(ipLimit.retryAfterSeconds!);
  }

  const body = await request.json().catch(() => null);
  const parsed = contactFormSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const env = getEnv();
  const submission = parsed.data;

  if (env.EMAIL_PROVIDER === 'console') {
    console.log('[contact] new submission', submission);
  } else {
    // TODO(Phase 7): send via the configured provider and create/update a
    // crm_contacts row so this shows up in the CRM, not just an inbox.
    console.log(`[contact] EMAIL_PROVIDER=${env.EMAIL_PROVIDER} not yet wired — logging only`, submission);
  }

  return Response.json({ ok: true });
}
