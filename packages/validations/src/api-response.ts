import type { ClientResponse } from 'hono/client';
import { REFUSAL_CODES, type RefusalCode } from './refusal-codes';

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
 * A refused request, as `apiResponse` throws it: the API's sentence is the message (what a screen shows), with
 * the refusal's machine-readable code when the API gave one (`RefusalCode`, refusal-codes.ts) and the HTTP status.
 * A screen acts on the code — points at the line it concerns, offers the next step — and never shows it.
 */
export class ApiRefusal extends Error {
  readonly status: number;
  readonly code: RefusalCode | undefined;
  constructor(message: string, status: number, code?: RefusalCode) {
    super(message);
    this.name = 'ApiRefusal';
    this.status = status;
    this.code = code;
  }
}

/** The refusal code of an error `apiResponse` threw, when the API gave one. */
export function refusalCodeOf(err: unknown): RefusalCode | undefined {
  return err instanceof ApiRefusal ? err.code : undefined;
}

function codeIn(body: unknown): RefusalCode | undefined {
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (REFUSAL_CODES as readonly string[]).includes(code) ? (code as RefusalCode) : undefined;
}

function codeOfText(text: string): RefusalCode | undefined {
  try {
    return codeIn(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/**
 * Unwrap an API response shaped as { success, data } | { success: false, error, code? }.
 * - Throws on HTTP errors an ApiRefusal: the API's sentence as the message, its refusal code when given
 * - Throws on API errors or missing data
 * - Infers return type from Hono RPC automatically (no generics needed)
 */
export async function apiResponse<R extends Promise<ClientResponse<any>>>(
  resPromise: R
): Promise<InferResponseData<R>> {
  const res = await resPromise;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiRefusal(errorSentence(text, res.status), res.status, codeOfText(text));
  }

  const json: any = await res.json();

  if (!json || typeof json !== 'object' || !json.success || !('data' in json)) {
    const message = typeof json?.error === 'string' && json.error ? json.error : `Request failed (${res.status})`;
    throw new ApiRefusal(message, res.status, codeIn(json));
  }

  return json.data as InferResponseData<R>;
}


