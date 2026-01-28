import { sql } from 'drizzle-orm';
import { db } from './db';

/**
 * Simple DB health check. Returns true if the database responds to SELECT 1.
 */
export async function pingDb(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}


