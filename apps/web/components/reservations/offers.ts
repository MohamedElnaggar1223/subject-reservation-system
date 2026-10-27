/**
 * The family read the reservation page, the swap, the teacher change and the approvals are built on
 * (`GET /v1/registrations/offers`, COORDINATOR_REWORK.md Appendix A): its v2 part only — `session` (name, dates,
 * prices final, the refund sentence, the declaration, the questions), `eligibility` and `offerings → rows → options`.
 * Its v1 part (`offers`, `availability`, `grade10Core`, `declarableSittings`) is P1c's to remove and is read nowhere.
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
