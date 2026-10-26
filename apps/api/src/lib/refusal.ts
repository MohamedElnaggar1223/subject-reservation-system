import { REFUSAL_CODES, type RefusalCode } from '@repo/validations';

/**
 * A refusal's machine-readable code (decision 2 of the P1b review): a service attaches it to the error it throws,
 * and the route passes it to `error()` with the sentence (`codeOf(err)`). The error keeps its own class and status.
 */
export function coded<E extends Error>(err: E, code: RefusalCode): E {
  return Object.assign(err, { refusalCode: code });
}

/** The code an error carries, if any (a driver error, or a refusal not yet coded, carries none). */
export function codeOf(err: unknown): RefusalCode | undefined {
  const c = (err as { refusalCode?: unknown } | null)?.refusalCode;
  return typeof c === 'string' && (REFUSAL_CODES as readonly string[]).includes(c) ? (c as RefusalCode) : undefined;
}

export type { RefusalCode };
