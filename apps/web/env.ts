import { z } from 'zod';

const schema = z.object({
  // Provide a sane default for local/dev to avoid build failure if unset
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),
  NODE_ENV: z.string().default('development')
});

const parsed = schema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NODE_ENV: process.env.NODE_ENV
});

if (!parsed.success) {
  console.error('❌ Invalid web env vars', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid web environment variables');
}

export const env = {
  apiUrl: parsed.data.NEXT_PUBLIC_API_URL,
  nodeEnv: parsed.data.NODE_ENV
};