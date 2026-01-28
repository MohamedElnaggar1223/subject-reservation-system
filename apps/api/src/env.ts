import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().min(1).default(3001),
  COOKIE_DOMAIN: z.string().optional(),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().optional(), // comma-separated list

  // Cloudflare R2 Configuration
  // Note: Bucket should be PRIVATE - files accessed via signed URLs only
  R2_ACCOUNT_ID: z.string().min(1, 'R2_ACCOUNT_ID is required'),
  R2_ACCESS_KEY_ID: z.string().min(1, 'R2_ACCESS_KEY_ID is required'),
  R2_SECRET_ACCESS_KEY: z.string().min(1, 'R2_SECRET_ACCESS_KEY is required'),
  R2_BUCKET_NAME: z.string().min(1, 'R2_BUCKET_NAME is required'),
  // R2_PUBLIC_URL removed - using private bucket with signed URLs for security
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
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

