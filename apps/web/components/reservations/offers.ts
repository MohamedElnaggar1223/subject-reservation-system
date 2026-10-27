/**
 * The family read the reservation page, the swap, the teacher change and the approvals are built on
 * (`GET /v1/registrations/offers`, COORDINATOR_REWORK.md Appendix A): its v2 part only — `session` (name, dates,
 * prices final, the refund sentence, the declaration, the questions), `eligibility` and `offerings → rows → options`.
 * Its v1 part (`offers`, `availability`, `grade10Core`, `declarableSittings`) is P1c's to remove: no family or desk screen
 * reads it; the exceptions grant form still does (`admin/exceptions/grant-form.client.tsx`).
 * Types come from the fetcher (PATTERNS.md), never by hand.
 */

import { api } from '~/lib/hono';
import { apiResponse } from '@repo/validations';

export const fetchReserveOffers = (sessionId: string, studentId?: string) =>
  apiResponse(api.v1.registrations.offers.$get({ query: { sessionId, ...(studentId ? { studentId } : {}) } }));
export type OffersRead = Awaited<ReturnType<typeof fetchReserveOffers>>;
export type Offering = OffersRead['offerings'][number];
export type OfferRow = Offering['rows'][number];
export type RowOption = OfferRow['options'][number];
export type Question = OffersRead['session']['questions'][number];

export const reserveOffersKey = (sessionId: string, studentId: string) => ['registrations', 'offers', sessionId, studentId] as const;

/** An option's key on its row: its attempt and mode. */
export const optionKey = (o: { attempt: string; mode: string }) => `${o.attempt}|${o.mode}`;

/** The row and option a line was reserved as, when the read still lists them (a closed subject is not listed). */
export function optionOfLine(read: OffersRead | undefined, line: { offerItemId: string; attempt: string; mode: string }) {
  for (const o of read?.offerings ?? []) {
    const row = o.rows.find((r) => r.id === line.offerItemId);
    if (row) return { offering: o, row, option: row.options.find((x) => optionKey(x) === optionKey(line)) ?? null };
  }
  return null;
}

/**
 * The one line a refusal's sentence names, else null. The API names a line by its subject, and by its row unless it
 * is all papers ("Mathematics — Paper 1": window.services lineNames); `nameOf` gives that name where the caller has
 * it (the statement's line label), else the subject's. The longest name found wins ("Human Biology" over "Biology");
 * a subject's name followed by " — " names one of its rows, not the subject. Two lines named alike (Biology O.L. and
 * Biology A.S./A.L.) give null: a refusal is never pinned to a guess, it stays at the page.
 */
export function lineNamedBy<T>(sentence: string, lines: readonly T[], nameOf: (l: T) => string): T | null {
  const names = (l: T) => {
    const name = nameOf(l);
    for (let at = sentence.indexOf(name); at >= 0; at = sentence.indexOf(name, at + 1)) {
      if (name.includes(' — ') || !sentence.startsWith(' — ', at + name.length)) return name.length;
    }
    return 0;
  };
  const hits = lines.map((l) => ({ l, n: names(l) })).filter((h) => h.n > 0);
  const top = Math.max(0, ...hits.map((h) => h.n));
  const best = hits.filter((h) => h.n === top);
  return best.length === 1 ? best[0]!.l : null;
}
