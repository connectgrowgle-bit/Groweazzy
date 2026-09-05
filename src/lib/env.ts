import { z } from 'zod';

// Validated once, at boot. A crashed deploy is recoverable in minutes;
// silently taking no money for a week (a misconfigured payment mode, an
// unset webhook secret) is not — so this refuses to boot on a mismatch
// rather than falling back to a "reasonable" default.
const envSchema = z
  .object({
    APP_ENV: z.enum(['development', 'staging', 'production']), // no default, deliberately
    APP_URL: z.string().url(),
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: z.coerce.boolean().default(false),
    SESSION_SECRET: z.string().min(32),
    PII_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'must be 32 bytes hex (openssl rand -hex 32)'),
    PAYMENT_PROVIDER: z.enum(['mock', 'razorpay']),
    PAYMENT_MODE: z.enum(['test', 'live']), // no default, deliberately
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    CRON_SECRET: z.string().min(16),
    EMAIL_PROVIDER: z.enum(['console', 'resend', 'ses']).default('console'),
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    SENTRY_DSN: z.string().optional(),
    TRUSTED_PROXY_HEADER: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.DATABASE_URL.includes('?schema=') || env.DATABASE_URL.includes('&schema=')) {
      // Drizzle tolerates a `schema` query param on the connection string;
      // `pg_dump` rejects it outright. Catching it here means the backup
      // script fails at boot time, not mid-incident.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_URL'],
        message: 'must not contain a ?schema= query parameter — pg_dump rejects it',
      });
    }

    if (env.APP_ENV !== 'development' && !env.APP_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_URL'],
        message: 'must be https:// outside development',
      });
    }

    if ((env.APP_ENV === 'staging' || env.APP_ENV === 'production') && !env.DATABASE_SSL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_SSL'],
        message: 'must be true in staging and production',
      });
    }

    if (env.APP_ENV === 'production' && !env.SENTRY_DSN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SENTRY_DSN'],
        message: 'required in production',
      });
    }

    if (env.PAYMENT_PROVIDER === 'razorpay') {
      if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RAZORPAY_KEY_ID'],
          message: 'RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are all required when PAYMENT_PROVIDER=razorpay',
        });
      }
      if (env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET && env.RAZORPAY_KEY_SECRET === env.RAZORPAY_WEBHOOK_SECRET) {
        // Mistake #: these come from separate Razorpay dashboard pages.
        // Conflating them makes every webhook verification fail.
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['RAZORPAY_WEBHOOK_SECRET'],
          message: 'must not equal RAZORPAY_KEY_SECRET — they are separate values from separate dashboard pages',
        });
      }
      if (env.RAZORPAY_KEY_ID) {
        const isTestKey = env.RAZORPAY_KEY_ID.startsWith('rzp_test_');
        const isLiveKey = env.RAZORPAY_KEY_ID.startsWith('rzp_live_');
        if (env.PAYMENT_MODE === 'live' && !isLiveKey) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['RAZORPAY_KEY_ID'],
            message: 'PAYMENT_MODE=live requires an rzp_live_ key',
          });
        }
        if (env.PAYMENT_MODE === 'test' && !isTestKey) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['RAZORPAY_KEY_ID'],
            message: 'PAYMENT_MODE=test requires an rzp_test_ key',
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Intentionally throws rather than falling back — see file header.
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  cached = parsed.data;
  return cached;
}
