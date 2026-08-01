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

  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

  RESEND_API_KEY: z.string().optional(),

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
