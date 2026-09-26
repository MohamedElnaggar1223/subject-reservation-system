import type { Context } from 'hono';
import type { ApiResponse } from '@repo/validations';
import { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Simple wrapper for successful responses
 * Use when you just want to return data with success: true
 */
export function success<T>(c: Context, data: T, statusCode: ContentfulStatusCode = 200) {
  return c.json<ApiResponse<T>>({ success: true, data }, statusCode);
}

/**
 * Simple wrapper for error responses
 * Use when you want to return an error with success: false
 */
export function error(c: Context, message: string, statusCode: ContentfulStatusCode = 500) {
  return c.json<ApiResponse<never>>({ 
    success: false, 
    error: message 
  }, statusCode);
}

/**
 * Message safe to return to a client.
 *
 * Domain errors thrown by our services are plain `new Error('human
 * message')` and are meant to be read by users. Driver errors (pg /
 * Drizzle) carry a SQLSTATE `code` and their messages leak table,
 * column, and constraint names — those are replaced with a generic
 * fallback and left for the server log.
 */
export function clientMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  // Driver errors carry a string `code` (pg: '23505' etc.). Drizzle wraps
  // them in a DrizzleQueryError whose message is the SQL text and whose
  // `cause` is the pg error — so check both, and never echo query text
  // (RF-07: 51 handlers were passing this straight to parents).
  const hasCode = (e: unknown) => typeof (e as { code?: unknown } | null)?.code === 'string';
  if (hasCode(err) || hasCode((err as { cause?: unknown }).cause)) return fallback;
  if (/^Failed query/i.test(err.message)) return fallback;
  return err.message;
}

/**
 * Lightweight try-catch wrapper for common async operations
 * OPTIONAL - only use if it makes your code simpler
 * You can always use try-catch manually if you need custom logic
 */
export async function handleAsync<T>(
  c: Context,
  handler: () => Promise<T>,
  errorMessage?: string
): Promise<Response> {
  try {
    const data = await handler();
    return success(c, data);
  } catch (err) {
    const msg = errorMessage || 'Operation failed';
    if (process.env.NODE_ENV === 'development') {
      console.error(`[ERROR] ${msg}:`, err);
    }
    return error(c, msg);
  }
}

