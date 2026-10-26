import { Pool } from 'pg';

/**
 * A plain connection to another database than the app's (a test's scratch database, where a migration is
 * checked against data built the old way): raw SQL only, one connection, closed by the caller.
 */
export function connectTo(connectionString: string) {
  const pool = new Pool({ connectionString, max: 1 });
  return {
    query: async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[],
    end: () => pool.end(),
  };
}
