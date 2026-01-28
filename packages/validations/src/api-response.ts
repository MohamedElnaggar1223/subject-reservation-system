import type { ClientResponse } from 'hono/client';

type SuccessBody<B> = Extract<B, { success: true; data: any }>;
type InferData<B> = SuccessBody<B> extends never ? never : SuccessBody<B>['data'];
type InferResponseData<R> = R extends Promise<ClientResponse<infer B, any, any>> ? InferData<B> : never;

/**
 * Unwrap an API response shaped as { success, data } | { success: false, error }.
 * - Throws on HTTP errors
 * - Throws on API errors or missing data
 * - Infers return type from Hono RPC automatically (no generics needed)
 */
export async function apiResponse<R extends Promise<ClientResponse<any>>>(
  resPromise: R
): Promise<InferResponseData<R>> {
  const res = await resPromise;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }

  const json: any = await res.json();

  if (!json || typeof json !== 'object' || !json.success || !('data' in json)) {
    const message = json?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }

  return json.data as InferResponseData<R>;
}


