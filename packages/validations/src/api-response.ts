import type { ClientResponse } from 'hono/client';

type SuccessBody<B> = Extract<B, { success: true; data: any }>;
type InferData<B> = SuccessBody<B> extends never ? never : SuccessBody<B>['data'];
type InferResponseData<R> = R extends Promise<ClientResponse<infer B, any, any>> ? InferData<B> : never;

/**
 * The sentence a person should read for a refused request. The API answers
 * { success: false, error: "sentence" }, and a failed validation answers
 * { success: false, error: ZodError } whose message is a JSON list of issues.
 * The raw body used to be thrown as-is, so every refusal on every screen read
 * as {"success":false,"error":"…"} (found in the money audit's screen checks).
 */
export function errorSentence(body: string, status: number): string {
  try {
    const e = JSON.parse(body)?.error;
    if (typeof e === 'string' && e) return e;
    if (e && typeof e.message === 'string') {
      try {
        const issues = JSON.parse(e.message);
        if (Array.isArray(issues)) {
          const messages = issues.map((i: { message?: unknown }) => i?.message).filter((m): m is string => typeof m === 'string');
          if (messages.length) return messages.join('; ');
        }
      } catch {
        // not a list of issues; fall through to the message itself
      }
      return e.message;
    }
  } catch {
    // not JSON; fall through to the raw text
  }
  return body || `Request failed (${status})`;
}

/**
 * Unwrap an API response shaped as { success, data } | { success: false, error }.
 * - Throws on HTTP errors, with the API's sentence as the message
 * - Throws on API errors or missing data
 * - Infers return type from Hono RPC automatically (no generics needed)
 */
export async function apiResponse<R extends Promise<ClientResponse<any>>>(
  resPromise: R
): Promise<InferResponseData<R>> {
  const res = await resPromise;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(errorSentence(text, res.status));
  }

  const json: any = await res.json();

  if (!json || typeof json !== 'object' || !json.success || !('data' in json)) {
    const message = json?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }

  return json.data as InferResponseData<R>;
}


