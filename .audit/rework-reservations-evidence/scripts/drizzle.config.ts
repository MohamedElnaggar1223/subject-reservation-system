// Scratch config: migrate a database with origin/main's migrations only (b438976).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  out: '/tmp/rwb/main-drizzle/packages/db/drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
