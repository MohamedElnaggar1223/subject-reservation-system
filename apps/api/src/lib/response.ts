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

