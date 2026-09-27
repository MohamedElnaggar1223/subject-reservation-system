import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().min(1).default(3001),
  COOKIE_DOMAIN: z.string().optional(),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().optional(),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().min(1).default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().min(1).default(50),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().min(1).default(15 * 60 * 1000),
  API_RATE_LIMIT_MAX: z.coerce.number().min(1).default(600),
  // The one request header a proxy in front of the API sets to the real
  // client address (cf-connecting-ip behind Cloudflare, x-real-ip behind a
  // load balancer). Unset: rate limits key on the socket address and every
  // client-supplied header is ignored (RF-11). A proxied deployment must set
  // it, or every user shares the proxy's bucket. Prefer a header the proxy
  // overwrites; x-forwarded-for works only with exactly one proxy (the
  // rightmost entry is used), and cf-connecting-ip only if the origin refuses
  // traffic that did not come through Cloudflare. See lib/client-ip.ts.
  CLIENT_IP_HEADER: z.string().trim().toLowerCase().optional(),

  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

  RESEND_API_KEY: z.string().optional(),

  // School receiving account shown to parents paying via InstaPay (V3 §6.11).
  // InstaPay has no merchant API; parents transfer to this account and submit
  // the transaction reference for finance verification.
  SCHOOL_BANK_NAME: z.string().optional(),
  SCHOOL_ACCOUNT_NAME: z.string().optional(),
  SCHOOL_ACCOUNT_NUMBER: z.string().optional(),
  SCHOOL_IBAN: z.string().optional(),

  // Legacy provider credentials — integrations disabled in V3 (kept for the
  // future PSP InstaPay path; see V3_PLAN §2.3).
  FAWRY_MERCHANT_CODE: z.string().optional(),
  FAWRY_SECURE_KEY: z.string().optional(),
  PAYMOB_HMAC_SECRET: z.string().optional(),
  PAYMOB_SECRET_KEY: z.string().optional(),
  PAYMOB_PUBLIC_KEY: z.string().optional(),
  PAYMOB_INTEGRATION_ID: z.string().optional(),
  PAYMOB_REDIRECT_URL: z.string().url().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

if (parsed.data.NODE_ENV === 'production' && !parsed.data.RESEND_API_KEY) {
  throw new Error('RESEND_API_KEY is required in production');
}

if (!parsed.data.RESEND_API_KEY) {
  console.warn('[env] RESEND_API_KEY not set — email sending will be stubbed');
}

export const env = parsed.data;

export const corsOrigins = parsed.data.CORS_ORIGINS
  ? parsed.data.CORS_ORIGINS.split(',').map((o: string) => o.trim()).filter(Boolean)
  : [
      'http://localhost:3000',
      'app://',
      ...(parsed.data.NODE_ENV === 'development'
        ? [
            'exp://*/*',
            'exp://10.0.0.*:*/*',
            'exp://192.168.*.*:*/*',
            'exp://172.*.*.*:*/*',
            'exp://localhost:*/*',
          ]
        : []),
    ];
