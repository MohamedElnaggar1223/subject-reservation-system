import type { Context, TypedResponse } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { JSONParsed } from 'hono/utils/types';

/**
 * Response envelopes as the RPC client sees them.
 *
 * The return types are spelled out on purpose. Letting `c.json<ApiResponse<T>>`
 * infer them ran Hono's JSONParsed mapped type over an object whose `data`
 * was still the deferred generic `T`, and that mapping dropped the `data`
 * key entirely — every route using success() typed as `{ success: true }`
 * on the client, the shared unwrapper inferred `never`, and call sites in
 * the apps cast responses by hand. Keeping JSONParsed on the `data` value
 * alone resolves correctly once T is known.
 */
export type SuccessResponse<T, U extends ContentfulStatusCode = 200> =
  Response & TypedResponse<{ success: true; data: JSONParsed<T> }, U, 'json'>;
export type ErrorResponse<U extends ContentfulStatusCode = 500> =
  Response & TypedResponse<{ success: false; error: string }, U, 'json'>;

/**
 * Simple wrapper for successful responses
 * Use when you just want to return data with success: true
 */
export function success<T, U extends ContentfulStatusCode = 200>(
  c: Context,
  data: T,
  statusCode?: U
): SuccessResponse<T, U> {
  return c.json({ success: true as const, data }, (statusCode ?? 200) as U) as unknown as SuccessResponse<T, U>;
}

/**
 * Simple wrapper for error responses
 * Use when you want to return an error with success: false
 */
export function error<U extends ContentfulStatusCode = 500>(
  c: Context,
  message: string,
  statusCode?: U
): ErrorResponse<U> {
  return c.json({ success: false as const, error: message }, (statusCode ?? 500) as U) as unknown as ErrorResponse<U>;
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
  const hidden = hasCode(err) || hasCode((err as { cause?: unknown }).cause) || /^Failed query/i.test(err.message);
  if (hidden) {
    // The client gets the fallback; the operator must still see the cause.
    const cause = (err as { cause?: unknown }).cause;
    console.error(`[api] hidden from client ("${fallback}"):`, err.message, cause instanceof Error ? `| cause: ${cause.message}` : '');
    return fallback;
  }
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

