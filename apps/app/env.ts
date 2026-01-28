import { z } from 'zod';

const schema = z.object({
  EXPO_PUBLIC_API_URL: z.string().url(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid expo env vars', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid expo environment variables');
}

export const env = {
  apiUrl: parsed.data.EXPO_PUBLIC_API_URL,
};


